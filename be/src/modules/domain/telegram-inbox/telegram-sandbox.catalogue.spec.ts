import type { SandboxCase, SandboxInput } from "@modules/domain/provider-sandbox"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { TELEGRAM_SANDBOX_CATALOGUE, TELEGRAM_SANDBOX_UPDATE_BASE } from "./telegram-sandbox.catalogue"
import { TELEGRAM_SEND_SANDBOX_CASES, TELEGRAM_STAFF_SANDBOX_CASES } from "./telegram-sandbox-send.catalogue"
import { telegramSenderOf, telegramUpdateRowsOf } from "./telegram.normalise.policy"
import { translateTelegramUpdateRow } from "./telegram-message.trigger"

const ACCOUNT = sandboxAccount({ id: "conn-t", workspaceId: "ws-1", provider: "telegram" })
const AT = new Date("2026-11-14T02:00:00.000Z")
const ASKED = { chatId: 700100200, text: "Chao shop, cho minh hoi gia bo hoa hong do nhe" }

const inboundOf = (id: string): NonNullable<SandboxCase["inbound"]> => {
    const found = TELEGRAM_SANDBOX_CATALOGUE.cases.find((one) => one.id === id)?.inbound
    if (found === undefined) throw new Error(`no inbound case ${id}`)
    return found
}

/** Sends one case through the real frame (as the one send does) and answers its bodies. */
const send = async (sandbox: ReturnType<typeof sandboxServiceOf>["sandbox"], id: string, input: SandboxInput = ASKED, at: Date = AT) => {
    const events = await sandbox.inbound(ACCOUNT, id, inboundOf(id), input, at)
    return events.map((event) => event.body as Record<string, unknown>)
}

describe("TELEGRAM_SANDBOX_CATALOGUE (owner ruling R62)", () => {
    it("names the provider and holds unique ids TELEGRAM-<n>: the five inbound cases (text, picture, file, voice, command), none polled, and no window case (Telegram has no reply window)", () => {
        const ids = TELEGRAM_SANDBOX_CATALOGUE.cases.map((one) => one.id)

        expect(TELEGRAM_SANDBOX_CATALOGUE.provider).toBe("telegram")
        expect(ids).toEqual(["TELEGRAM-1", "TELEGRAM-2", "TELEGRAM-3", "TELEGRAM-4", "TELEGRAM-5", "TELEGRAM-6", "TELEGRAM-7"])
        expect(TELEGRAM_SANDBOX_CATALOGUE.cases.some((one) => one.inbound?.polled === true)).toBe(false)
        expect(TELEGRAM_SANDBOX_CATALOGUE.cases.every((one) => one.inbound !== undefined)).toBe(true)
        expect(TELEGRAM_SANDBOX_CATALOGUE.cases.some((one) => /window/i.test(one.label))).toBe(false)
    })

    it("TELEGRAM-3..5 make the Bot API's own updates: a PDF document, a voice, and a /start command with its bot_command entity", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        const [doc] = await send(sandbox, "TELEGRAM-3", { chatId: 700100200, fileName: "bao-gia.pdf" })
        const [voice] = await send(sandbox, "TELEGRAM-4", { chatId: 700100200 })
        const [command] = await send(sandbox, "TELEGRAM-5", { chatId: 700100200, command: "/start" })
        const messageOf = (body: Record<string, unknown> | undefined) => body?.message as Record<string, unknown>
        expect(messageOf(doc).document).toMatchObject({ file_name: "bao-gia.pdf", mime_type: "application/pdf" })
        expect(messageOf(doc).text).toBeUndefined()
        expect(messageOf(voice).voice).toMatchObject({ mime_type: "audio/ogg" })
        expect(messageOf(voice).text).toBeUndefined()
        expect(messageOf(command)).toMatchObject({ text: "/start", entities: [{ offset: 0, length: 6, type: "bot_command" }] })
    })

    it("has unique ids across the catalogue and the send and staff cases, each the provider's key and number", () => {
        const ids = [...TELEGRAM_SANDBOX_CATALOGUE.cases, ...TELEGRAM_SEND_SANDBOX_CASES, ...TELEGRAM_STAFF_SANDBOX_CASES].map((one) => one.id)

        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^TELEGRAM-(SEND-|STAFF-)?\d+$/.test(id))).toBe(true)
    })

    it("gives every inbound case Telegram's real route and its provider-word inputs", () => {
        for (const id of ["TELEGRAM-1", "TELEGRAM-2"]) expect(inboundOf(id).path("conn-9")).toBe("api/telegram/conn-9")
        expect(inboundOf("TELEGRAM-1").inputs.map((field) => [field.name, field.kind])).toEqual([
            ["chatId", "integer"],
            ["text", "text"],
        ])
        expect(inboundOf("TELEGRAM-2").inputs.map((field) => field.name)).toEqual(["chatId"])
        expect(inboundOf("TELEGRAM-1").trigger).toBe("message.received")
    })

    it("TELEGRAM-1 makes a message update with the text, the chat, the sender and a date from the send, with a running update id", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const [first] = await send(sandbox, "TELEGRAM-1")
        const [second] = await send(sandbox, "TELEGRAM-1", { chatId: 700100300, text: "Hai" })

        expect(first).toMatchObject({
            update_id: TELEGRAM_SANDBOX_UPDATE_BASE + 1,
            message: {
                message_id: 1,
                from: { id: 700100200, is_bot: false },
                chat: { id: 700100200, type: "private" },
                date: Math.floor(AT.getTime() / 1000),
                text: ASKED.text,
            },
        })
        expect(second).toMatchObject({ update_id: TELEGRAM_SANDBOX_UPDATE_BASE + 2, message: { message_id: 2, chat: { id: 700100300 }, text: "Hai" } })
    })

    it("TELEGRAM-2 makes a message update with a photo array and no text", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const [body] = await send(sandbox, "TELEGRAM-2", { chatId: 700100200 })

        const message = (body as { message: Record<string, unknown> }).message
        expect(message.text).toBeUndefined()
        expect(message.caption).toBeUndefined()
        expect(Array.isArray(message.photo)).toBe(true)
        expect((message.photo as Array<{ file_id: string }>).map((size) => size.file_id)).toEqual(["sbx-photo-1-s", "sbx-photo-1-l"])
    })

    it("builds bodies the real Telegram intake reads: the update row, the sender and the message trigger's translate (text and photo)", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        const [text] = await send(sandbox, "TELEGRAM-1")
        const [photo] = await send(sandbox, "TELEGRAM-2")

        for (const body of [text, photo]) {
            const rows = telegramUpdateRowsOf(Buffer.from(JSON.stringify(body)))
            expect(rows).toHaveLength(1)
            expect(telegramSenderOf(body)).toMatchObject({ userId: "700100200", firstName: "Khach Sandbox" })
        }
        const translated = (body: unknown) =>
            translateTelegramUpdateRow(
                { updateId: String((body as { update_id: number }).update_id), raw: body as Record<string, unknown> },
                { connectionId: "conn-t" },
            )
        expect(translated(text)?.data).toMatchObject({ text: ASKED.text, attachments: [] })
        expect(translated(photo)?.data.attachments).toEqual([expect.objectContaining({ kind: "image", fileId: "sbx-photo-2-l" })])
    })

    it("is deterministic and reads no clock: the same send on a fresh account gives the same body", async () => {
        const first = await send(sandboxServiceOf(ACCOUNT).sandbox, "TELEGRAM-1")
        const second = await send(sandboxServiceOf(ACCOUNT).sandbox, "TELEGRAM-1")

        expect(second).toEqual(first)
    })

    it("logs each send as one inbound call keyed by the case id", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        await send(sandbox, "TELEGRAM-1")

        expect((await sandbox.calls(ACCOUNT, "inbound")).map((one) => one.key)).toEqual(["TELEGRAM-1"])
    })
})
