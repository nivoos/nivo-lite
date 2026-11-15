import type {
    SandboxCase,
    SandboxCatalogue,
    SandboxInboundCase,
    SandboxInboundContext,
    SandboxInput,
    SandboxInputField,
    SandboxWebhookEvent,
} from "@modules/domain/provider-sandbox"
import { TELEGRAM_PROVIDER } from "./telegram.data-types"

/** The provider key of the Telegram bot catalogue: `connections.provider` names it so. */
export const TELEGRAM_SANDBOX_PROVIDER = TELEGRAM_PROVIDER

/** The `update_id` of a sandbox account's inbound sends counts on from here: its n-th inbound send posts `TELEGRAM_SANDBOX_UPDATE_BASE + n`. */
export const TELEGRAM_SANDBOX_UPDATE_BASE = 700_000_000

/** The name Telegram gives the customer of the sandbox bot (`from.first_name`, `chat.first_name`). */
export const TELEGRAM_SANDBOX_CUSTOMER_NAME = "Khach Sandbox"

/** The webhook route of a Telegram bot on NIVO for one account. */
const telegramRoute = (connectionId: string): string => `api/telegram/${connectionId}`

/** The input naming the chat of the person (TELEGRAM-1 and TELEGRAM-2): Telegram's own chat id, an integer. */
const CHAT_FIELD: SandboxInputField = {
    name: "chatId",
    label: "Chat id của khách / Chat id of the person",
    kind: "integer",
    example: 700100200,
}

/** The input naming the file the person sends (TELEGRAM-3). */
const FILE_NAME_FIELD: SandboxInputField = { name: "fileName", label: "Tên tệp / File name", kind: "text", example: "bao-gia.pdf" }

/** The input holding the command the person types (TELEGRAM-5): `/start` or any `/word`. */
const COMMAND_FIELD: SandboxInputField = { name: "command", label: "Lệnh / Command", kind: "text", example: "/start" }

/** The input holding the line the person writes (TELEGRAM-1). */
const TEXT_FIELD: SandboxInputField = {
    name: "text",
    label: "Nội dung tin / Message text",
    kind: "text",
    example: "Chao shop, cho minh hoi gia bo hoa hong do nhe",
}

/** The chat id as Telegram posts it: a whole number when the input is one, else the text as given. */
const chatIdOf = (input: SandboxInput): number | string => {
    const value = input.chatId
    const number = typeof value === "number" ? value : Number(value)
    return Number.isSafeInteger(number) ? number : String(value ?? "")
}

/** The two sizes of a Telegram photo (`message.photo`: a small and a large `PhotoSize`, ids running with the update). */
const photoSizesOf = (running: number): ReadonlyArray<Readonly<Record<string, unknown>>> => [
    { file_id: `sbx-photo-${String(running)}-s`, file_unique_id: `sbx-u-${String(running)}-s`, file_size: 1_240, width: 90, height: 90 },
    { file_id: `sbx-photo-${String(running)}-l`, file_unique_id: `sbx-u-${String(running)}-l`, file_size: 48_600, width: 1_280, height: 960 },
]

/** What the person sends the bot: a text, a photo, a document (a PDF), a voice message or a bot command (`/start`). */
type TelegramSandboxKind = "text" | "photo" | "document" | "voice" | "command" | "sticker"

/** The members of the message that make each kind, in the Bot API's own shapes (`document`, `voice`, `entities` of a `bot_command`). */
const messageMembersOf = (kind: TelegramSandboxKind, input: SandboxInput, running: number): Readonly<Record<string, unknown>> => {
    const text = typeof input.text === "string" ? input.text : ""
    switch (kind) {
        case "photo":
            return { photo: photoSizesOf(running) }
        case "document":
            return {
                document: {
                    file_id: `sbx-doc-${String(running)}`,
                    file_unique_id: `sbx-u-doc-${String(running)}`,
                    file_name: typeof input.fileName === "string" ? input.fileName : "file.pdf",
                    mime_type: "application/pdf",
                    file_size: 48_600,
                },
            }
        case "voice":
            return {
                voice: { file_id: `sbx-voice-${String(running)}`, file_unique_id: `sbx-u-voice-${String(running)}`, duration: 4, mime_type: "audio/ogg", file_size: 9_300 },
            }
        case "sticker":
            return {
                sticker: {
                    file_id: `sbx-sticker-${String(running)}`,
                    file_unique_id: `sbx-u-sticker-${String(running)}`,
                    type: "regular",
                    width: 512,
                    height: 512,
                    is_animated: false,
                    is_video: false,
                    emoji: "\uD83D\uDE00",
                },
            }
        case "command": {
            const command = typeof input.command === "string" && input.command.startsWith("/") ? input.command : "/start"
            return { text: command, entities: [{ offset: 0, length: command.split(" ")[0]?.length ?? command.length, type: "bot_command" }] }
        }
        case "text":
            return { text }
    }
}

/**
 * One Telegram inbound case: a person's message becomes ONE update as the Bot API posts it (`update_id` running from the account's
 * inbound sends, `message.date` the sender's moment in seconds, then the members of the kind). Telegram has no reply window, so nothing is
 * kept in the account's state: a bot may write to a chat that has written to it at any time. Telegram has no poll for a bot that has a
 * webhook, so no case is `polled`.
 */
const caseOf = (kind: TelegramSandboxKind, inputs: ReadonlyArray<SandboxInputField>, edited = false): SandboxInboundCase => ({
    trigger: "message.received",
    path: telegramRoute,
    inputs,
    eventsOf: (input: SandboxInput, context: SandboxInboundContext): Promise<ReadonlyArray<SandboxWebhookEvent>> => {
        const running = context.state.seq + 1
        const chatId = chatIdOf(input)
        const body = {
            update_id: TELEGRAM_SANDBOX_UPDATE_BASE + running,
            // An edited message is the Bot API's `edited_message` update (the member name is the whole difference).
            [edited ? "edited_message" : "message"]: {
                message_id: running,
                from: { id: chatId, is_bot: false, first_name: TELEGRAM_SANDBOX_CUSTOMER_NAME, language_code: "vi" },
                chat: { id: chatId, first_name: TELEGRAM_SANDBOX_CUSTOMER_NAME, type: "private" },
                date: Math.floor(context.at.getTime() / 1000),
                ...(edited ? { edit_date: Math.floor(context.at.getTime() / 1000) } : {}),
                ...messageMembersOf(kind, input, running),
            },
        }
        return Promise.resolve([{ body }])
    },
})

/**
 * Telegram bot's hardcoded sandbox cases (owner ruling R62): two inbound TRANSFORMATIONS of `{ chatId, text }` / `{ chatId }` into the
 * update Telegram posts on `api/telegram/<connectionId>` (a text line, a picture with no text: Telegram's `message.photo`, no text), with
 * no window case because Telegram has no reply window. The customer SEND, the staff text and "typing" answer from
 * `telegram-sandbox-send.catalogue.ts` (TELEGRAM-SEND-1..3, TELEGRAM-STAFF-1..2).
 */
export const TELEGRAM_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: TELEGRAM_SANDBOX_PROVIDER,
    cases: [
        {
            id: "TELEGRAM-1",
            label: "A person writes the bot a text line: a message update with its text, dated at the send",
            inbound: caseOf("text", [CHAT_FIELD, TEXT_FIELD]),
        },
        {
            id: "TELEGRAM-2",
            label: "A person sends the bot a picture and no text: a message update with a photo array and no text",
            inbound: caseOf("photo", [CHAT_FIELD]),
        },
        {
            id: "TELEGRAM-3",
            label: "A person sends the bot a file: a message update with a document (a PDF with its file name) and no text",
            inbound: caseOf("document", [CHAT_FIELD, FILE_NAME_FIELD]),
        },
        {
            id: "TELEGRAM-4",
            label: "A person sends the bot a voice message: a message update with a voice and no text (a kind NIVO's message trigger does not read: no line is made)",
            inbound: caseOf("voice", [CHAT_FIELD]),
        },
        {
            id: "TELEGRAM-5",
            label: "A person types a bot command (/start by default): a message update whose text is the command with its bot_command entity",
            inbound: caseOf("command", [CHAT_FIELD, COMMAND_FIELD]),
        },
        {
            id: "TELEGRAM-6",
            label: "A person edits a message they sent: an edited_message update (NIVO's message trigger drops it: no new line)",
            inbound: caseOf("text", [CHAT_FIELD, TEXT_FIELD], true),
        },
        {
            id: "TELEGRAM-7",
            label: "A person sends the bot a sticker: a message update with a sticker and no text (a kind NIVO's message trigger does not read: no line is made)",
            inbound: caseOf("sticker", [CHAT_FIELD]),
        },
    ] satisfies ReadonlyArray<SandboxCase>,
}
