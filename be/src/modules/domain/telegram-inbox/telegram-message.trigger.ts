import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import { z } from "zod"
import type {
    DeclaredLine,
    OptionalCanonicalEvent,
    TriggerDeclaration,
    TriggerOrigin,
} from "@modules/domain/provider-triggers"
import { telegramUpdate } from "./telegram.data-types"

/*
 * THE TELEGRAM BOT'S MESSAGE TRIGGER (stage 1 of the one event pipeline, concept triggers rule 13): a message a person sends the bot, as
 * ONE canonical event. Pure: the translate reads only its argument. A message is an update with a `message` that has an id, a chat and
 * any content: its words (the text, or a caption) and EVERY part Telegram sends (photo, sticker, document of any type, animation, voice,
 * audio, video, video note: a file by its id; a location, a venue, a contact: a typed part with no file), none dropped for its kind (the
 * inbound contract, `DeclaredLine`); no word is written for a part. An edited message, a join, a message with no content are dropped.
 * `/start` is a message like any other: its text says
 * `/start` and the package's first node reads it (the trigger carries no start flag).
 */

/** The trigger's name inside the provider. */
export const TELEGRAM_MESSAGE_RECEIVED = "message.received"

/** The channel of a Telegram person's identity. */
export const TELEGRAM_CHANNEL = "telegram"

/** One part of a Telegram message as the update names it: a file (no address yet, only the id `getFile` turns into one) or a typed part. */
export interface TelegramMessageFile {
    /** `image` for a photo, a sticker or an image sent as a file; `file` for any other part. */
    readonly kind: "image" | "file"
    /** Telegram's `file_id`; empty for a part with no file. */
    readonly fileId: string
    /** The file name the sender gave, or an empty text; for a part with no file, what Telegram sent of it. */
    readonly name: string
    /** The size in bytes Telegram gave, or null. */
    readonly size: number | null
    /** Set only for a part with no file (a location, a venue, a contact): its media type. */
    readonly contentType?: string | undefined
}

/** The media types of a part that carries no file (standard IANA types): a contact card, a place. */
const CONTACT_PART = "text/vcard"
const PLACE_PART = "application/geo+json"

/** The members of a message that carry ONE file each, with what the shop reads it as (a sticker is a picture). */
const FILE_MEMBERS: ReadonlyArray<readonly [string, TelegramMessageFile["kind"]]> = [
    ["sticker", "image"],
    ["animation", "file"],
    ["voice", "file"],
    ["audio", "file"],
    ["video", "file"],
    ["video_note", "file"],
]

/** The data of one Telegram message (the channel message members of every channel, plus the provider's attachments). */
export type TelegramMessageData = {
    /** The key the line is stored once under: `tg:<connection>:<chat id>:<message id>` (a message id is unique only inside its bot's chat). */
    readonly messageKey: string
    /** What the person wrote (the text, or a part's caption), as sent; empty for a message of parts only. */
    readonly text: string
    /** When it was sent (ISO 8601, the message `date`), or null when the update carries none. */
    readonly at: string | null
    /** The pictures and files sent with it, by Telegram's file id (the entry asks `getFile` and keeps the bytes); empty for a text. */
    readonly attachments: ReadonlyArray<TelegramMessageFile>
    /** Set only on the engine's release delivery of the channel verb (`held`): no new words. */
    readonly resume?: "held" | undefined
}

/** The `telegram.update` row the webhook kept: the update untouched in `raw`. The translate's raw. */
export interface TelegramUpdateRow {
    /** Telegram's `update_id`, as the row keys it. */
    readonly updateId: string
    /** The update Telegram posted, as JSON. */
    readonly raw: Readonly<Record<string, unknown>>
}

/** True for a JSON object (an array included, as the platform primitive reads it): the translate names no other piece. */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null

/** A text field of an object, or an empty text. */
const textOf = (source: unknown, name: string): string => {
    const value = isRecord(source) ? source[name] : undefined
    return typeof value === "string" ? value : ""
}

/** A finite number field of an object, or NaN. */
const numberOf = (source: unknown, name: string): number => {
    const value = isRecord(source) ? source[name] : undefined
    return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN
}

/** A list field of an object, or an empty list. */
const listOf = (source: unknown, name: string): ReadonlyArray<unknown> => {
    const value = isRecord(source) ? source[name] : undefined
    return Array.isArray(value) ? value : []
}

/** The name the payload gives the person: first and last name, else the @username; absent when it gives neither. */
const nameOf = (from: unknown): string => {
    const name = [textOf(from, "first_name"), textOf(from, "last_name")].filter((part) => part !== "").join(" ")
    if (name !== "") return name
    const username = textOf(from, "username")
    return username === "" ? "" : `@${username}`
}

/** The size Telegram gave for a file, or null. */
const sizeOf = (file: unknown): number | null => {
    const size = numberOf(file, "file_size")
    return Number.isNaN(size) ? null : size
}

/** The pixels of one PhotoSize; 0 when Telegram gave none. */
const areaOf = (size: unknown): number => {
    const area = numberOf(size, "width") * numberOf(size, "height")
    return Number.isNaN(area) ? 0 : area
}

/** The largest size of a photo (the area decides, then the bytes: the docs promise no order), as one picture. */
const photoOf = (sizes: ReadonlyArray<unknown>): ReadonlyArray<TelegramMessageFile> => {
    const usable = sizes.filter((size) => textOf(size, "file_id") !== "")
    const [largest] = [...usable].sort(
        (left, right) => areaOf(right) - areaOf(left) || (sizeOf(right) ?? 0) - (sizeOf(left) ?? 0),
    )
    if (largest === undefined) return []
    return [{ kind: "image", fileId: textOf(largest, "file_id"), name: "", size: sizeOf(largest) }]
}

/** A document of any type: a picture sent as a file reads as `image`, any other as `file` (its bytes decide whether it is kept). */
const documentOf = (document: unknown): ReadonlyArray<TelegramMessageFile> => {
    const fileId = textOf(document, "file_id")
    if (fileId === "") return []
    const kind = textOf(document, "mime_type").toLowerCase().startsWith("image/") ? "image" : "file"
    return [{ kind, fileId, name: textOf(document, "file_name"), size: sizeOf(document) }]
}

/** The one-file members of a message (sticker, animation, voice, audio, video, video note), each by its file id. */
const filesOf = (message: Readonly<Record<string, unknown>>): ReadonlyArray<TelegramMessageFile> =>
    FILE_MEMBERS.flatMap(([member, kind]) => {
        const file = message[member]
        const fileId = textOf(file, "file_id")
        return fileId === "" ? [] : [{ kind, fileId, name: textOf(file, "file_name"), size: sizeOf(file) }]
    })

/** A part with no file, its words as Telegram sent them joined by a space. */
const typedPart = (contentType: string, words: ReadonlyArray<string>): TelegramMessageFile => ({
    kind: "file",
    fileId: "",
    name: words.filter((word) => word !== "").join(" "),
    size: null,
    contentType,
})

/** The parts with no file: a venue (its place, title and address) or a bare location, and a contact card, as Telegram sent them. */
const typedPartsOf = (message: Readonly<Record<string, unknown>>): ReadonlyArray<TelegramMessageFile> => {
    const venue = message.venue
    const place = isRecord(venue) ? venue.location : message.location
    const contact = message.contact
    return [
        ...(isRecord(place)
            ? [
                  typedPart(PLACE_PART, [
                      `${String(numberOf(place, "latitude"))},${String(numberOf(place, "longitude"))}`,
                      textOf(venue, "title"),
                      textOf(venue, "address"),
                  ]),
              ]
            : []),
        ...(isRecord(contact)
            ? [typedPart(CONTACT_PART, [textOf(contact, "first_name"), textOf(contact, "last_name"), textOf(contact, "phone_number")])]
            : []),
    ]
}

/** Every part of a message in one list; a file Telegram names twice (an animation is also its document) is kept once. */
const partsOf = (message: Readonly<Record<string, unknown>>): ReadonlyArray<TelegramMessageFile> => {
    const all = [...photoOf(listOf(message, "photo")), ...filesOf(message), ...documentOf(message.document), ...typedPartsOf(message)]
    return all.filter((part, index) => part.fileId === "" || all.findIndex((other) => other.fileId === part.fileId) === index)
}

/** The time of a message (`date`, Unix seconds) as ISO 8601, or null. */
const atOf = (message: unknown): string | null => {
    const seconds = numberOf(message, "date")
    return Number.isNaN(seconds) || seconds <= 0 ? null : new Date(seconds * 1000).toISOString()
}

/** The translate: the message of one stored update on its bot's account, or null for anything the chat does not answer. */
export const translateTelegramUpdateRow = (
    row: TelegramUpdateRow,
    origin: TriggerOrigin,
): OptionalCanonicalEvent<TelegramMessageData> => {
    const message = row.raw.message
    const updateId = numberOf(row.raw, "update_id")
    const messageId = numberOf(message, "message_id")
    const chatId = isRecord(message) ? numberOf(message.chat, "id") : Number.NaN
    if (!isRecord(message) || Number.isNaN(updateId) || Number.isNaN(messageId) || Number.isNaN(chatId)) return null
    const files = partsOf(message)
    const written = textOf(message, "text")
    const text = (written === "" ? textOf(message, "caption") : written).trim()
    if (text === "" && files.length === 0) return null
    const name = nameOf(message.from)
    const chat = String(chatId)
    return {
        id: String(updateId),
        subject: { channel: TELEGRAM_CHANNEL, id: chat, ...(name === "" ? {} : { name }) },
        data: {
            messageKey: `tg:${origin.connectionId ?? ""}:${chat}:${String(messageId)}`,
            text,
            at: atOf(message),
            attachments: files,
        },
    }
}

/** The data schema of a Telegram message. */
const TELEGRAM_MESSAGE_DATA: z.ZodType<TelegramMessageData> = z.object({
    messageKey: z.string(),
    text: z.string(),
    at: z.string().nullable(),
    attachments: z.array(
        z.object({
            kind: z.enum(["image", "file"]),
            fileId: z.string(),
            name: z.string(),
            size: z.number().nullable(),
            contentType: z.string().optional(),
        }),
    ),
    resume: z.literal("held").optional(),
})

/** The raw schema: the stored `telegram.update` row value. */
const TELEGRAM_UPDATE_ROW: z.ZodType<TelegramUpdateRow> = z.object({
    updateId: z.string().min(1),
    raw: z.record(z.string(), z.unknown()),
})

/** A customer line settles: the run starts once the person has been quiet for 6 s, 20 s after their first line at most (customer-messages rule 13). */
const CHAT_SETTLE = { windowMs: 6000, maxWaitMs: 20_000 } as const

/** The message trigger as the bot's webhook receives it. */
/**
 * The line the person said, as the engine keeps it on the route (owner ruling R26): the message key, the words, the channel's time. The
 * release door's delivery carries no key and is no line. A `/start` is a line: it is what the person sent. Pure.
 */
export const telegramLineOf = (data: TelegramMessageData): DeclaredLine | null =>
    data.messageKey === "" ? null : { key: data.messageKey, text: data.text, at: data.at }

export const TELEGRAM_MESSAGE_WEBHOOK: TriggerDeclaration<TelegramUpdateRow, TelegramMessageData> = {
    provider: PROVIDER.telegram,
    name: TELEGRAM_MESSAGE_RECEIVED,
    verb: TRIGGER.telegramMessageReceived,
    via: ["webhook"],
    // Verified 2026-11-14 (core.telegram.org/bots/api): getUpdates "will not work if an outgoing webhook is set up", so a bot with a webhook
    // cannot be polled; a webhook request that fails is repeated and given up "after a reasonable amount of attempts", updates kept 24 hours.
    withoutPoll: {
        reason: {
            vi: "Telegram không cho đọc tin (getUpdates) khi bot đã đặt webhook; chính Telegram giữ và gửi lại cập nhật chưa nhận được, tối đa 24 giờ.",
            en: "Telegram refuses getUpdates while the bot has a webhook; Telegram itself keeps and re-sends an undelivered update, for at most 24 hours.",
        },
        source: "https://core.telegram.org/bots/api",
    },
    words: {
        title: { vi: "Telegram · Tin nhắn đến", en: "Telegram · Message received" },
        summary: {
            vi: "Một người nhắn cho bot Telegram của bạn (chữ, ảnh, nhãn dán, tệp, ảnh động, ghi âm, âm thanh, video, vị trí hoặc danh bạ).",
            en: "A person sends your Telegram bot a message (text, a photo, a sticker, a file, an animation, a voice note, audio, a video, a location or a contact).",
        },
        members: {
            messageKey: { vi: "Mã tin nhắn (duy nhất trong bot)", en: "The message's key (unique inside the bot)" },
            text: { vi: "Nội dung người đó viết", en: "What the person wrote" },
            at: { vi: "Thời điểm gửi", en: "When it was sent" },
            attachments: { vi: "Mọi phần gửi kèm (tệp, hoặc vị trí / danh bạ không có tệp)", en: "Every part sent with it (a file, or a location / contact with no file)" },
        },
    },
    dataType: telegramUpdate.name,
    raw: TELEGRAM_UPDATE_ROW,
    data: TELEGRAM_MESSAGE_DATA,
    translate: translateTelegramUpdateRow,
    feeds: { stream: "lines", line: telegramLineOf },
    key: { by: "subject" },
    settle: CHAT_SETTLE,
    // The person's lines append to the route's stream: held lines are ONE marker the workflow reads the stream from (rule Q-4).
    combine: "stream",
}

/** Every trigger the Telegram provider declares. */
export const TELEGRAM_TRIGGERS: ReadonlyArray<TriggerDeclaration<TelegramUpdateRow, TelegramMessageData>> = [
    TELEGRAM_MESSAGE_WEBHOOK,
]
