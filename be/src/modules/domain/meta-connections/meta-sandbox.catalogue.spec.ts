import type { SandboxCase, SandboxInput } from "@modules/domain/provider-sandbox"
import { parseWebhook } from "@modules/integrations/meta"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import {
    META_REPLY_WINDOW_MS,
    META_INBOUND_CASE,
    META_SANDBOX_CATALOGUE,
    META_SANDBOX_IG_ID,
    META_SANDBOX_LAST_LINE_STATE,
    META_SANDBOX_PAGE_ID,
    META_SANDBOX_STALE_AGE_MS,
    metaLastLineAt,
} from "./meta-sandbox.catalogue"
import { META_SEND_SANDBOX_CASES } from "./meta-sandbox-send.catalogue"

const ACCOUNT = sandboxAccount({ id: "conn-m", workspaceId: "ws-1", provider: "meta" })
const AT = new Date("2026-11-14T02:00:00.000Z")
const ASKED = { psid: "7700110022", text: "Chao shop, cho minh hoi gia bo hoa hong do nhe" }

const inboundOf = (id: string): NonNullable<SandboxCase["inbound"]> => {
    const found = META_SANDBOX_CATALOGUE.cases.find((one) => one.id === id)?.inbound
    if (found === undefined) throw new Error(`no inbound case ${id}`)
    return found
}

/** Sends one case through the real frame (as the one send does) and answers its bodies. */
const send = async (sandbox: ReturnType<typeof sandboxServiceOf>["sandbox"], id: string, input: SandboxInput = ASKED, at: Date = AT) => {
    const events = await sandbox.inbound(ACCOUNT, id, inboundOf(id), input, at)
    return events.map((event) => event.body as Record<string, unknown>)
}

describe("META_SANDBOX_CATALOGUE (owner ruling R62)", () => {
    it("names the provider and holds unique ids META-<n>: twenty inbound cases, the six first three per platform", () => {
        const ids = META_SANDBOX_CATALOGUE.cases.map((one) => one.id)

        expect(META_SANDBOX_CATALOGUE.provider).toBe("meta")
        expect(ids).toEqual(Array.from({ length: 20 }, (_, index) => `META-${String(index + 1)}`))
        expect(Object.values(META_INBOUND_CASE).toSorted()).toEqual([...ids].toSorted())
        expect(META_SANDBOX_CATALOGUE.cases.every((one) => one.inbound !== undefined)).toBe(true)
        expect([...ids, ...META_SEND_SANDBOX_CASES.map((one) => one.id)].every((id) => /^META-(SEND-)?\d+$/.test(id))).toBe(true)
        expect(new Set([...ids, ...META_SEND_SANDBOX_CASES.map((one) => one.id)]).size).toBe(ids.length + META_SEND_SANDBOX_CASES.length)
    })

    it("gives every inbound case the sandbox door of the Meta app webhook, which names the account, and its provider-word inputs", () => {
        for (const id of META_SANDBOX_CATALOGUE.cases.map((one) => one.id)) {
            expect(inboundOf(id).path("conn-9")).toBe("api/connections/meta/webhook/conn-9")
        }
        expect(["META-1", "META-2", "META-3"].map((id) => inboundOf(id).trigger)).toEqual(Array(3).fill("facebook.message.received"))
        expect(["META-4", "META-5", "META-6"].map((id) => inboundOf(id).trigger)).toEqual(Array(3).fill("instagram.message.received"))
        expect(inboundOf("META-1").inputs.map((field) => field.name)).toEqual(["psid", "text"])
        expect(inboundOf("META-2").inputs.map((field) => field.name)).toEqual(["psid"])
        expect(inboundOf("META-3").inputs.map((field) => field.name)).toEqual(["psid", "text"])
    })

    it.each([
        ["META-1", "facebook", META_SANDBOX_PAGE_ID, 0],
        ["META-3", "facebook", META_SANDBOX_PAGE_ID, META_SANDBOX_STALE_AGE_MS],
        ["META-4", "instagram", META_SANDBOX_IG_ID, 0],
        ["META-6", "instagram", META_SANDBOX_IG_ID, META_SANDBOX_STALE_AGE_MS],
    ])("%s makes a %s text line body Meta's real parser reads as a dm of the person, with a running id (surface %s, stamped %d ms before the send)", async (id, platform, surface, age) => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const [body] = await send(sandbox, id)
        const [second] = await send(sandbox, id, { psid: "7700110033", text: "Hai" })

        expect(body).toMatchObject({ object: platform === "facebook" ? "page" : "instagram", entry: [{ id: surface }] })
        const [event] = parseWebhook(body, 0)
        expect(event).toMatchObject({
            kind: "dm",
            platform,
            text: ASKED.text,
            mid: "sbx-mid-000001",
            timestamp: AT.getTime() - age,
            ...(platform === "facebook" ? { page_id: surface, sender_psid: "7700110022" } : { ig_id: surface, sender_igsid: "7700110022" }),
        })
        expect(parseWebhook(second, 0)[0]).toMatchObject({ mid: "sbx-mid-000002", text: "Hai" })
    })

    it.each([
        ["META-2", "facebook"],
        ["META-5", "instagram"],
    ])("%s makes a %s picture body with an image attachment and no text, a dm all the same", async (id, platform) => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const [body] = await send(sandbox, id, { psid: "7700110022" })

        const message = ((body as { entry: Array<{ messaging: Array<{ message: Record<string, unknown> }> }> }).entry[0]?.messaging[0] ?? { message: {} }).message
        expect(message.text).toBeUndefined()
        expect((message.attachments as Array<{ type: string }>)[0]?.type).toBe("image")
        expect(parseWebhook(body, 0)).toEqual([expect.objectContaining({ kind: "dm", platform, text: null })])
    })

    it("keeps what Meta remembers: the person's last line is the stamped moment, so META-3 leaves a line older than the 24-hour window", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        await send(sandbox, "META-1")
        const fresh = await sandbox.call(ACCOUNT, "probe", {}, { answer: (state) => metaLastLineAt(state, ASKED.psid) })
        await send(sandbox, "META-3", { psid: "7700110044", text: "Shop oi" })
        const stale = await sandbox.call(ACCOUNT, "probe", {}, { answer: (state) => metaLastLineAt(state, "7700110044") })
        const never = await sandbox.call(ACCOUNT, "probe", {}, { answer: (state) => state.read(META_SANDBOX_LAST_LINE_STATE, "nobody") })

        expect(fresh).toBe(AT.getTime())
        expect(AT.getTime() - (stale ?? 0)).toBe(META_SANDBOX_STALE_AGE_MS)
        expect(META_SANDBOX_STALE_AGE_MS).toBeGreaterThan(META_REPLY_WINDOW_MS)
        expect(never).toBeNull()
    })

    it("is deterministic and reads no clock: the same send on a fresh account gives the same body", async () => {
        const first = await send(sandboxServiceOf(ACCOUNT).sandbox, "META-1")
        const second = await send(sandboxServiceOf(ACCOUNT).sandbox, "META-1")

        expect(second).toEqual(first)
    })

    it("logs each send as one inbound call keyed by the case id", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        await send(sandbox, "META-4")

        expect((await sandbox.calls(ACCOUNT, "inbound")).map((one) => one.key)).toEqual(["META-4"])
    })

    it.each([
        ["META-7", "facebook", "dm", "GET_PRICE", { psid: "7700110022", payload: "GET_PRICE" }],
        ["META-8", "instagram", "dm", "GET_PRICE", { psid: "7700110022", payload: "GET_PRICE" }],
        ["META-11", "facebook", "postback", "Xem giá", { psid: "7700110022", payload: "GET_PRICE", title: "Xem giá" }],
        ["META-12", "instagram", "postback", "Xem giá", { psid: "7700110022", payload: "GET_PRICE", title: "Xem giá" }],
    ])("%s makes a %s quick reply / postback body Meta's real parser reads as a %s whose words are the payload or the title (%s)", async (id, platform, kind, words, input) => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const [body] = await send(sandbox, id, input)

        expect(parseWebhook(body, 0)).toEqual([expect.objectContaining({ kind, platform, text: words, postback_payload: "GET_PRICE" })])
    })

    it.each([
        ["META-9", "facebook"],
        ["META-10", "instagram"],
    ])("%s makes a %s non-picture attachment body (the type is the sender's) the live parser reads as a dm with no text", async (id, platform) => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const [body] = await send(sandbox, id, { psid: "7700110022", type: "audio" })

        const message = ((body as { entry: Array<{ messaging: Array<{ message: Record<string, unknown> }> }> }).entry[0]?.messaging[0] ?? { message: {} }).message
        expect((message.attachments as Array<{ type: string }>)[0]?.type).toBe("audio")
        expect(parseWebhook(body, 0)).toEqual([expect.objectContaining({ kind: "dm", platform, text: null })])
    })

    it.each([
        ["META-13", { psid: "7700110022", text: "Cam on ban" }],
        ["META-14", { psid: "7700110022" }],
    ])("%s (the Page's echo, a delivery receipt) is accepted by the door and the live parser reads NO event from it", async (id, input) => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const [body] = await send(sandbox, id, input)

        expect((body as { object: string }).object).toBe("page")
        expect(parseWebhook(body, 0)).toEqual([])
    })

    it.each([
        ["META-15", "facebook", "comment", "comment:sbx-comment-000001"],
        ["META-16", "instagram", "comment", "comment:sbx-comment-000001"],
        ["META-17", "facebook", "leadgen", "leadgen:sbx-lead-000001"],
        ["META-18", "facebook", "mention", "mention:sandbox-page_sbx-post-000001"],
        ["META-19", "instagram", "mention", "mention:sbx-comment-000001"],
    ])("%s makes a %s %s body Meta's real parser reads (%s): an event with no direct message", async (id, platform, kind, eventKey) => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const [body] = await send(sandbox, id, { psid: "7700110022", text: "Bo hoa nay con khong shop oi" })

        expect(parseWebhook(body, 0)).toEqual([expect.objectContaining({ kind, platform, event_key: eventKey })])
    })

    it("META-20 posts a body that is no JSON object (an array): the one body the door refuses, and it keeps no last line", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const events = await sandbox.inbound(ACCOUNT, "META-20", inboundOf("META-20"), {}, AT)

        expect(events).toEqual([{ body: [] }])
        expect(parseWebhook([], 0)).toEqual([])
    })

    it("keeps a last line only for a direct message: a quick reply and an attachment open the reply window, a postback, a comment and an echo do not", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        const lastLine = (psid: string) => sandbox.call(ACCOUNT, "probe", {}, { answer: (state) => metaLastLineAt(state, psid) })

        await send(sandbox, "META-7", { psid: "u-quick", payload: "P" })
        await send(sandbox, "META-9", { psid: "u-file", type: "file" })
        await send(sandbox, "META-11", { psid: "u-postback", payload: "P", title: "T" })
        await send(sandbox, "META-15", { psid: "u-comment", text: "Hi" })

        expect(await lastLine("u-quick")).toBe(AT.getTime())
        expect(await lastLine("u-file")).toBe(AT.getTime())
        expect(await lastLine("u-postback")).toBeNull()
        expect(await lastLine("u-comment")).toBeNull()
    })
})
