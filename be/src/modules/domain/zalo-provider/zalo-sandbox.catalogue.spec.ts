import type { SandboxCase, SandboxInput } from "@modules/domain/provider-sandbox"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import {
    ZALO_SANDBOX_CATALOGUE,
    ZALO_SANDBOX_LAST_LINE_STATE,
    ZALO_SANDBOX_MESSAGES_STATE,
    zaloLastLineAt,
    zaloMessagesOf,
} from "./zalo-sandbox.catalogue"

const ACCOUNT = sandboxAccount({ id: "conn-z", workspaceId: "ws-1", provider: "zalo_oa" })
const AT = new Date("2026-11-14T02:00:00.000Z")
const ASKED = { userId: "8800110022", text: "Chao shop, cho minh hoi gia bo hoa hong do nhe" }

const inboundOf = (id: string): NonNullable<SandboxCase["inbound"]> => {
    const found = ZALO_SANDBOX_CATALOGUE.cases.find((one) => one.id === id)?.inbound
    if (found === undefined) throw new Error(`no inbound case ${id}`)
    return found
}

/** Sends one case through the real frame (as the one send does) and answers its bodies. */
const send = async (sandbox: ReturnType<typeof sandboxServiceOf>["sandbox"], id: string, input: SandboxInput = ASKED, at: Date = AT) => {
    const events = await sandbox.inbound(ACCOUNT, id, inboundOf(id), input, at)
    return events.map((event) => event.body as Record<string, unknown>)
}

describe("ZALO_SANDBOX_CATALOGUE (owner ruling R62)", () => {
    it("names the provider, holds unique ids ZALO-<n>, the inbound cases ZALO-1..3 and 6..9 (file, video, voice, sticker)", () => {
        const ids = ZALO_SANDBOX_CATALOGUE.cases.map((one) => one.id)

        expect(ZALO_SANDBOX_CATALOGUE.provider).toBe("zalo_oa")
        expect(ids).toEqual(["ZALO-1", "ZALO-2", "ZALO-3", "ZALO-4", "ZALO-5", "ZALO-6", "ZALO-7", "ZALO-8", "ZALO-9", "ZALO-10", "ZALO-11", "ZALO-12", "ZALO-13"])
        expect(new Set(ids).size).toBe(ids.length)
        expect(ZALO_SANDBOX_CATALOGUE.cases.map((one) => one.inbound !== undefined)).toEqual([true, true, true, false, false, true, true, true, true, true, true, false, false])
    })

    it("gives every inbound case Zalo's real route and its provider-word inputs", () => {
        for (const id of ["ZALO-1", "ZALO-2", "ZALO-3"]) expect(inboundOf(id).path("conn-9")).toBe("api/connections/zalo/conn-9")
        expect(inboundOf("ZALO-1").inputs.map((field) => [field.name, field.kind])).toEqual([
            ["userId", "text"],
            ["text", "text"],
        ])
        expect(inboundOf("ZALO-2").inputs.map((field) => field.name)).toEqual(["userId"])
        expect(inboundOf("ZALO-3").inputs.map((field) => field.name)).toEqual(["userId", "text"])
    })

    it("ZALO-1 makes a user_send_text body stamped at the send, with a running message id", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const [first] = await send(sandbox, "ZALO-1")
        const [second] = await send(sandbox, "ZALO-1", { userId: "8800110033", text: "Hai" })

        expect(first).toMatchObject({
            app_id: "sandbox-app",
            user_id_by_app: "8800110022",
            event_name: "user_send_text",
            timestamp: String(AT.getTime()),
            sender: { id: "8800110022" },
            recipient: { id: "sandbox-oa" },
            message: { msg_id: "sbx-zmsg-000001", text: ASKED.text },
        })
        expect(second).toMatchObject({ message: { msg_id: "sbx-zmsg-000002", text: "Hai" }, sender: { id: "8800110033" } })
    })

    it("ZALO-2 makes a user_send_image body with an attachment and no text", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const [body] = await send(sandbox, "ZALO-2", { userId: "8800110033" })

        expect(body).toMatchObject({ event_name: "user_send_image", sender: { id: "8800110033" }, message: { msg_id: "sbx-zmsg-000001" } })
        expect((body?.message as Record<string, unknown>).text).toBeUndefined()
        expect((body?.message as { attachments: Array<{ type: string }> }).attachments[0]?.type).toBe("image")
    })

    it("ZALO-3 is ZALO-1 under the generic `late` delivery by 49 hours (outside the 48-hour window); ZALO-1 and ZALO-3 are the polled kinds", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        expect(inboundOf("ZALO-3").delivery).toEqual({ mode: "late", lateBySeconds: 49 * 3_600 })
        expect([1, 2, 3, 6, 7, 8, 9].map((n) => inboundOf(`ZALO-${String(n)}`).polled === true)).toEqual([true, false, true, false, false, false, false])

        // The frame builds a `late` case at the arrival minus the interval (proven in the frame spec): the case itself stamps its `at`.
        const [body] = await send(sandbox, "ZALO-3", ASKED, new Date(AT.getTime() - 49 * 3_600_000))

        expect(body).toMatchObject({ event_name: "user_send_text", timestamp: String(AT.getTime() - 49 * 3_600_000) })
        const kept = zaloMessagesOf(await sandbox.call(ACCOUNT, "peek", {}, { answer: (state) => state.read(ZALO_SANDBOX_MESSAGES_STATE, "") }))
        expect(kept).toHaveLength(1)
        expect(kept[0]).toMatchObject({ sentAt: AT.getTime() - 49 * 3_600_000, kind: "text" })
    })

    it("keeps the last line time per user (state last-line) and the messages for the poll, readable by zaloLastLineAt", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        const later = new Date("2026-11-14T05:00:00.000Z")

        await send(sandbox, "ZALO-1")
        await send(sandbox, "ZALO-3", { userId: "8800110044", text: "Cu" }, new Date(AT.getTime() - 49 * 3_600_000))
        await send(sandbox, "ZALO-2", { userId: "8800110022" }, later)

        const read = (userId: string) => sandbox.call(ACCOUNT, "peek", {}, { answer: (state) => zaloLastLineAt(state, userId) })
        expect(ZALO_SANDBOX_LAST_LINE_STATE).toBe("last-line")
        expect(await read("8800110022")).toBe(later.getTime())
        expect(await read("8800110044")).toBe(AT.getTime() - 49 * 3_600_000)
        expect(await read("8800110099")).toBeNull()
        const kept = zaloMessagesOf(await sandbox.call(ACCOUNT, "peek", {}, { answer: (state) => state.read(ZALO_SANDBOX_MESSAGES_STATE, "") }))
        expect(kept.map((one) => [one.messageId, one.kind])).toEqual([
            ["sbx-zmsg-000001", "text"],
            ["sbx-zmsg-000002", "text"],
            ["sbx-zmsg-000003", "photo"],
        ])
    })

    it("ZALO-6..9 make Zalo's own events for a file, a video, a voice message and a sticker, each with one attachment and no text", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        const bodies = [
            await send(sandbox, "ZALO-6", { userId: "8800110022", fileName: "bao-gia.pdf" }),
            await send(sandbox, "ZALO-7", { userId: "8800110022" }),
            await send(sandbox, "ZALO-8", { userId: "8800110022" }),
            await send(sandbox, "ZALO-9", { userId: "8800110022" }),
        ].map(([one]) => one)
        expect(bodies.map((one) => one?.event_name)).toEqual(["user_send_file", "user_send_video", "user_send_audio", "user_send_sticker"])
        const attachments = bodies.map((one) => (one?.message as { attachments: Array<{ type: string; payload: Record<string, unknown> }>; text?: string }))
        expect(attachments.map((one) => one.attachments[0]?.type)).toEqual(["file", "video", "audio", "sticker"])
        expect(attachments[0]?.attachments[0]?.payload).toMatchObject({ name: "bao-gia.pdf", url: expect.stringContaining("sandbox.invalid") })
        expect(attachments.every((one) => one.text === undefined)).toBe(true)
    })

    it("ZALO-10 and ZALO-11 are Zalo's follow and unfollow events with follower.id and no message, keeping nothing in state", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        const [follow] = await send(sandbox, "ZALO-10", { userId: "8800110022" })
        const [unfollow] = await send(sandbox, "ZALO-11", { userId: "8800110022" })
        expect(follow).toMatchObject({ event_name: "follow", follower: { id: "8800110022" } })
        expect(unfollow).toMatchObject({ event_name: "unfollow", follower: { id: "8800110022" } })
        expect(follow?.message).toBeUndefined()
        expect(zaloMessagesOf(await sandbox.call(ACCOUNT, "peek", {}, { answer: (state) => state.read(ZALO_SANDBOX_MESSAGES_STATE, "") }))).toEqual([])
    })

    it("is deterministic: the same inputs and moment on a fresh account make the same body", async () => {
        const left = await send(sandboxServiceOf(ACCOUNT).sandbox, "ZALO-1")
        const right = await send(sandboxServiceOf(ACCOUNT).sandbox, "ZALO-1")

        expect(left).toEqual(right)
    })

    it("marks exactly one default case of the profile operation", () => {
        const profile = ZALO_SANDBOX_CATALOGUE.cases.filter((one) => one.operation === "profileOf")

        expect(profile.map((one) => [one.id, one.default === true])).toEqual([
            ["ZALO-4", true],
            ["ZALO-5", false],
            ["ZALO-12", false],
            ["ZALO-13", false],
        ])
    })
})
