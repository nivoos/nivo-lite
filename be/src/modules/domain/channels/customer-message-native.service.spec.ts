import { FakeClock, mock } from "@starci/jest-preset"
import { CONTEXT_NOTICE } from "@modules/domain/context-sources"
import { CustomerMessagesService, StreamCursorService, type CustomerLine } from "@modules/domain/customer-routes"
import { MemoryStreamCursorStore } from "@tests/fixtures/builders/customer-routes-stores.builder"
import { THREAD_LIST_DEFAULT, THREAD_TEXT_MAX } from "./customer-message-native.schema"
import { CONVERSATION_MESSAGE_MANIFEST, CONVERSATION_SOURCE, CustomerMessageNativeService } from "./customer-message-native.service"

const ROUTE = "route-1"
const NOW = new Date("2026-11-14T03:00:00.000Z")
const CALLER = { agentId: "agent-sales", conversationId: ROUTE }

const line = (over: Partial<CustomerLine> = {}): CustomerLine => ({
    id: "l-1",
    seq: "1",
    routeId: ROUTE,
    contactId: "contact-1",
    direction: "from_person",
    key: "msg-1",
    saidAt: "2026-11-14T02:00:00.000Z",
    text: "Shop còn hoa hồng không?",
    files: [],
    order: null,
    eventId: "ev-1",
    agentId: null,
    memberId: null,
    runId: null,
    stepKey: null,
    state: null,
    reason: null,
    channel: "zalo",
    accountId: "conn-1",
    deliveredAt: null,
    ...over,
})

const build = (rows: ReadonlyArray<CustomerLine>) => {
    const lines = mock<CustomerMessagesService>()
    lines.threadOf.mockResolvedValue({ rows, next: null })
    return { lines, service: new CustomerMessageNativeService(lines, new FakeClock(NOW)) }
}

describe("CustomerMessageNativeService (nivo.tool.conversation.message.list, engine-served)", () => {
    it("is the one read-only thread read of every agent, served by the engine under the id the nodes already call", () => {
        expect(CONVERSATION_MESSAGE_MANIFEST.namespace).toBe("nivo.tool.conversation.message")
        expect(CONVERSATION_MESSAGE_MANIFEST.tools.map((tool) => [tool.name, tool.scope, tool.defaultMode])).toEqual([["list", "read", "auto"]])
    })

    it("answers both directions of the run's route newest first, every sender, only delivered sends, in the context-read shape", async () => {
        const told = line({
            id: "l-2",
            direction: "to_person",
            key: "send-1",
            saidAt: "2026-11-14T02:01:00.000Z",
            text: "Dạ còn ạ",
            agentId: "agent-front",
            state: "delivered",
            files: [{ url: "https://files.example/rose.jpg", name: "rose.jpg", contentType: "image/jpeg" }],
        })
        const typed = line({ id: "l-3", direction: "to_person", key: "send-2", text: "Chị gửi ảnh nhé", memberId: "member-1", state: "delivered" })
        const { service, lines } = build([typed, told, line()])

        const answer = await service.invoke("ws-1", "list", {}, CALLER)

        expect(lines.threadOf).toHaveBeenCalledWith("ws-1", ROUTE, { limit: THREAD_LIST_DEFAULT, told: "delivered" })
        expect(answer).toEqual({
            notice: CONTEXT_NOTICE,
            source: CONVERSATION_SOURCE,
            asOf: NOW.toISOString(),
            // No stream cursor in this app (none composed): the reader falls back to "after the shop's last line".
            consumedSeq: null,
            facts: [
                { seq: "1", role: "agent", direction: "to_person", text: "Chị gửi ảnh nhé", at: typed.saidAt, agentId: null, memberId: "member-1" },
                {
                    seq: "1",
                    role: "agent",
                    direction: "to_person",
                    text: "Dạ còn ạ",
                    at: told.saidAt,
                    files: [{ url: "https://files.example/rose.jpg", contentType: "image/jpeg" }],
                    agentId: "agent-front",
                    memberId: null,
                },
                { seq: "1", role: "user", direction: "from_person", text: "Shop còn hoa hồng không?", at: "2026-11-14T02:00:00.000Z", agentId: null, memberId: null },
            ],
        })
    })

    it("passes the caller's limit and cuts a long text at the bound", async () => {
        const { service, lines } = build([line({ text: "x".repeat(THREAD_TEXT_MAX + 50) })])

        const answer = await service.invoke("ws-1", "list", { limit: 5 }, CALLER)

        expect(lines.threadOf).toHaveBeenCalledWith("ws-1", ROUTE, { limit: 5, told: "delivered" })
        expect(JSON.stringify(answer)).toContain(`"text":"${"x".repeat(THREAD_TEXT_MAX)}"`)
    })

    it("reads only the lines said from a lower limit in time when the caller gives one (a chatbot's current visit)", async () => {
        const { service, lines } = build([line()])

        await service.invoke("ws-1", "list", { since: "2026-11-14T01:30:00.000Z" }, CALLER)
        await expect(service.invoke("ws-1", "list", { since: "yesterday" }, CALLER)).rejects.toThrow()

        expect(lines.threadOf).toHaveBeenCalledWith("ws-1", ROUTE, { limit: THREAD_LIST_DEFAULT, told: "delivered", since: "2026-11-14T01:30:00.000Z" })
        expect(lines.threadOf).toHaveBeenCalledTimes(1)
    })

    it("refuses another route before reading anything, and reads no line for a run with no route", async () => {
        const { service, lines } = build([line()])

        await expect(service.invoke("ws-1", "list", { conversationId: "route-other" }, CALLER)).rejects.toMatchObject({ params: { reason: "other_conversation" } })
        await expect(service.invoke("ws-1", "list", { conversationId: ROUTE }, CALLER)).resolves.toMatchObject({ facts: [expect.anything()] })
        await expect(service.invoke("ws-1", "list", {}, { agentId: "agent-1", conversationId: null })).resolves.toMatchObject({ facts: [] })
        expect(lines.threadOf).toHaveBeenCalledTimes(1)
    })

    // Ruling R51 item 1: the door fills EVERY subject member the run token carries into a locked read; this read is scoped by the route only.
    it("takes the contact and the lead the door fills beside the route (unread), and still reads the run's route only", async () => {
        const { service, lines } = build([line()])

        await expect(
            service.invoke("ws-1", "list", { limit: 20, conversationId: ROUTE, contactId: "contact-1", leadId: "lead-1" }, CALLER),
        ).resolves.toMatchObject({ facts: [expect.anything()] })
        await expect(service.invoke("ws-1", "list", { limit: 20, orderId: "o-1" }, CALLER)).rejects.toThrow()

        expect(lines.threadOf).toHaveBeenCalledTimes(1)
        expect(lines.threadOf).toHaveBeenCalledWith("ws-1", ROUTE, { limit: 20, told: "delivered" })
    })

    it("refuses a tool it does not serve", async () => {
        const { service } = build([])

        await expect(service.invoke("ws-1", "send", {}, CALLER)).rejects.toThrow()
    })

    // THE STREAM CURSOR (rule QB-P5 C-4): the answer names what runs consumed of the route; a read inside a graph step is that step's
    // pending read (under its call key) until the step ends; a read outside a step (no step key) notes nothing.
    it("answers the route's cursor and notes a graph step's CONSUMING read as pending until that step ends", async () => {
        const store = new MemoryStreamCursorStore()
        const cursor = new StreamCursorService(store)
        const lines = mock<CustomerMessagesService>()
        lines.threadOf.mockResolvedValue({
            rows: [line({ seq: "12", direction: "to_person", state: "delivered" }), line({ seq: "11" }), line({ seq: "10" })],
            next: null,
        })
        const service = new CustomerMessageNativeService(lines, new FakeClock(NOW), cursor)
        const step = { ...CALLER, graphStep: true as const, opKey: "run-1:hear:d1" }

        // A read for context (no `consume`) notes nothing.
        await service.invoke("ws-1", "list", {}, { ...step, opKey: "run-1:understand:d1" })
        expect(store.rows.get(ROUTE)).toBeUndefined()
        expect(await service.invoke("ws-1", "list", { consume: true }, step)).toMatchObject({ consumedSeq: null })
        expect(store.rows.get(ROUTE)?.read).toEqual({ by: "run-1:hear:d1", seq: "11" })
        await cursor.stepEnded("ws-1", "run-1", "hear")
        expect(await service.invoke("ws-1", "list", {}, CALLER)).toMatchObject({ consumedSeq: "11", facts: [{ seq: "12" }, { seq: "11" }, { seq: "10" }] })
        // A consuming read outside a step notes nothing new.
        await service.invoke("ws-1", "list", { consume: true }, CALLER)
        expect(store.rows.get(ROUTE)?.read).toBeNull()
    })
})
