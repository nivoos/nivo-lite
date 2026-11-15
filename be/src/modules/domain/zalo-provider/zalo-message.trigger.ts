import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import type { DeclaredLine, OptionalCanonicalEvent, TriggerDeclaration } from "@modules/domain/provider-triggers"
import { ZALO_MESSAGE_WORDS } from "./messages/zalo-trigger.messages"
import { ZALO_EVENT_ROW, ZALO_MESSAGE_DATA } from "./zalo-message.trigger.schema"

/*
 * THE ZALO OA'S MESSAGE TRIGGER (stage 1 of the one event pipeline, concept triggers rule 13): what a customer writes to the OA, as ONE
 * canonical event. It is received by the OA's webhook and by the poll of the OA's inbox (`via: ["webhook", "poll"]`: one event, two ways); the poll
 * keeps the same `zalo_oa.event` row under the same key (the body the webhook would have posted), so both ways give one event. Pure: the translate reads
 * only its arguments. What counts as a message is Zalo's documented customer-message events (`user_send_*`: text, image, gif, sticker,
 * audio, video, file, link, location, business card): every part of one is mapped, none dropped for its kind (the inbound contract,
 * `DeclaredLine`); every other event (follow, seen, an OA message) is dropped.
 */

/** The trigger's name inside the provider. */
export const ZALO_MESSAGE_RECEIVED = "message.received"

/** The account_data type its raw rows are kept as (`zalo.data-types` declares it; a declaration file takes no value from another folder). */
const ZALO_EVENT_DATA_TYPE = "zalo_oa.event"

/** The channel of a Zalo customer's identity. */
export const ZALO_CHANNEL = "zalo"

/** The event of a customer writing text to the OA. */
const TEXT_EVENT = "user_send_text"

/** Zalo's documented events of a customer message with parts (each part's own `type` says what it is). */
const PART_EVENTS: ReadonlySet<string> = new Set([
    "user_send_image",
    "user_send_gif",
    "user_send_sticker",
    "user_send_audio",
    "user_send_video",
    "user_send_file",
    "user_send_link",
    "user_send_location",
    "user_send_business_card",
])

/** The event whose parts are contact cards, whatever type word each part carries. */
const BUSINESS_CARD_EVENT = "user_send_business_card"

/** Zalo's part types whose bytes are a picture (the shop reads them as `image`); every other part with an address is a `file`. */
const PICTURE_PARTS: ReadonlySet<string> = new Set(["image", "gif", "sticker"])

/** The media types of a part that carries no file (standard IANA types): a link, a contact card, a place. */
const LINK_PART = "text/uri-list"
const CONTACT_PART = "text/vcard"
const PLACE_PART = "application/geo+json"

/** The door a stored event came by when it was not the webhook: a manual import may name a file of the import folder. */
const MANUAL_IMPORT = "manual_import"

/** One part of a Zalo customer message, as Zalo sends it (`{ type, payload: { url, thumbnail, name, coordinates, description } }`). */
export interface ZaloAttachment {
    /** `image` for a picture (an image, a gif, a sticker), `file` for any other part. */
    readonly kind: "image" | "file"
    /** The https address Zalo gives (it expires: the entry keeps the bytes before the delivery); empty for a file of a manual import. */
    readonly url: string
    /** The address of a smaller preview, or an empty text. */
    readonly thumbnailUrl: string
    /** The name the sender gave, or an empty text. */
    readonly name: string
    /** The path of a manual import inside the import folder; empty for any other source. */
    readonly localPath: string
    /** Set only for a part with no file (a link, a contact card, a location): its media type; `name` then holds what Zalo sent of it. */
    readonly contentType?: string | undefined
}

/** The data of one Zalo customer message (the channel message members of every channel, plus the provider's attachments). */
export type ZaloMessageData = {
    /** The key the line is stored once under, the same for the webhook and the poll: `zalo:<msg_id>`. */
    readonly messageKey: string
    /** What the customer wrote (a part's caption), as sent; empty for a message of parts only. */
    readonly text: string
    /** When the customer sent it (ISO 8601), as the event says; null when the event carries no usable time. */
    readonly at: string | null
    /** Every part sent with it, as Zalo names them (a file, or a typed part with no file); empty for a text. */
    readonly attachments: ReadonlyArray<ZaloAttachment>
    /** Set only on the engine's release delivery of the channel verb (`held`): no new words. */
    readonly resume?: "held" | undefined
}

/** A Zalo webhook body as JSON carries it: an object of any members, read only through the translate's own pieces. */
export type ZaloBody = Readonly<Record<string, unknown>>

/** The `zalo_oa.event` row the webhook, the poll or a manual import kept: the body untouched in `raw`. The translate's raw. */
export interface ZaloEventRow {
    /** The row's key. */
    readonly eventId: string
    /** Zalo's `event_name`, when the body names one. */
    readonly event?: string | undefined
    /** The door, when it was not the webhook (`poll`, `manual_import`). */
    readonly source?: string | undefined
    /** The body Zalo posted (or the poll made of a listed message), as JSON. */
    readonly raw: ZaloBody
}

/** True for a JSON object (an array included, as the platform primitive reads it): the translate names no other piece. */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null

/** A text field of an object, or an empty text. */
const textOf = (source: unknown, name: string): string => {
    const value = isRecord(source) ? source[name] : undefined
    return typeof value === "string" ? value : ""
}

/** A list field of an object, or an empty list. */
const listOf = (source: unknown, name: string): ReadonlyArray<unknown> => {
    const value = isRecord(source) ? source[name] : undefined
    return Array.isArray(value) ? value : []
}

/** A time field in epoch milliseconds, given as a number or as its digits; null when it is missing or no positive time. */
const millisOf = (source: unknown, name: string): number | null => {
    const value = isRecord(source) ? source[name] : undefined
    const millis = typeof value === "string" && value.trim() !== "" ? Number(value) : value
    return typeof millis === "number" && Number.isFinite(millis) && millis > 0 ? millis : null
}

/** A number field of an object, or null. */
const numberOf = (source: unknown, name: string): number | null => {
    const value = isRecord(source) ? source[name] : undefined
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * One part as the line keeps it: a picture or a file with its address (empty when Zalo gave none: the pipeline records it typed
 * not-kept); a link, a contact card or a location as a typed part with no file, its content as Zalo sent it.
 */
const partOf = (eventName: string, item: unknown, allowLocalPath: boolean): ZaloAttachment => {
    const type = textOf(item, "type")
    const payload = isRecord(item) ? item.payload : undefined
    const url = textOf(payload, "url")
    const base = { url: "", thumbnailUrl: textOf(payload, "thumbnail"), name: "", localPath: "" }
    if (eventName === BUSINESS_CARD_EVENT)
        return { ...base, kind: "file", name: textOf(payload, "description") || url, contentType: CONTACT_PART }
    if (type === "link") return { ...base, kind: "file", name: url, contentType: LINK_PART }
    if (type === "location") {
        const at = isRecord(payload) ? payload.coordinates : undefined
        const [latitude, longitude] = [numberOf(at, "latitude") ?? textOf(at, "latitude"), numberOf(at, "longitude") ?? textOf(at, "longitude")]
        return { ...base, kind: "file", name: `${String(latitude)},${String(longitude)}`, contentType: PLACE_PART }
    }
    return {
        ...base,
        kind: PICTURE_PARTS.has(type) ? "image" : "file",
        url,
        name: textOf(payload, "name"),
        localPath: allowLocalPath ? textOf(item, "localPath") : "",
    }
}

/** Every part of a message, in Zalo's order; none dropped for its kind. */
const partsOf = (eventName: string, message: unknown, allowLocalPath: boolean): ReadonlyArray<ZaloAttachment> =>
    listOf(message, "attachments").flatMap((item: unknown) => (isRecord(item) ? [partOf(eventName, item, allowLocalPath)] : []))

/**
 * The customer message of one Zalo body: its words and every part. Null for any other event and for one that lacks the sender, the
 * message id, or any content (no words and no part). Zalo's webhook names
 * no customer name or picture; a body the poll made of a listed message carries the name the listing shows as `sender.display_name`.
 */
export const zaloMessageOfBody = (
    body: ZaloBody,
    allowLocalPath: boolean = false,
): OptionalCanonicalEvent<ZaloMessageData> => {
    const name = textOf(body, "event_name")
    const userId = textOf(body.sender, "id")
    const messageId = textOf(body.message, "msg_id")
    const text = textOf(body.message, "text").trim()
    const sentAt = millisOf(body, "timestamp")
    if (userId === "" || messageId === "") return null
    if (name !== TEXT_EVENT && !PART_EVENTS.has(name)) return null
    const attachments = name === TEXT_EVENT ? [] : partsOf(name, body.message, allowLocalPath)
    if (text === "" && attachments.length === 0) return null
    const shown = textOf(body.sender, "display_name").trim()
    return {
        id: messageId,
        subject: { channel: ZALO_CHANNEL, id: userId, ...(shown === "" ? {} : { name: shown }) },
        data: {
            messageKey: `${ZALO_CHANNEL}:${messageId}`,
            text,
            at: sentAt === null ? null : new Date(sentAt).toISOString(),
            attachments,
        },
    }
}

/** The Zalo app a webhook body was sent for (`app_id`), or an empty text: what the entry's verify compares with the connection's app. */
export const zaloAppIdOf = (body: ZaloBody): string => textOf(body, "app_id")

/** The translate: the stored event row's message, files of the import folder allowed only for a manual import. */
export const translateZaloEventRow = (row: ZaloEventRow): OptionalCanonicalEvent<ZaloMessageData> =>
    zaloMessageOfBody(row.raw, row.source === MANUAL_IMPORT)

/** A customer line settles: the run starts once the person has been quiet for 6 s, 20 s after their first line at most (customer-messages rule 13). */
const CHAT_SETTLE = { windowMs: 6000, maxWaitMs: 20_000 } as const

/**
 * The line the person said, as the engine keeps it on the route (owner ruling R26): the message key, the words, the channel's time. The
 * release door's delivery carries no key and is no line. Pure.
 */
export const zaloLineOf = (data: ZaloMessageData): DeclaredLine | null =>
    data.messageKey === "" ? null : { key: data.messageKey, text: data.text, at: data.at }

/** The message trigger: received by the webhook and by the poll of the OA's inbox, both keeping the same `zalo_oa.event` row. */
export const ZALO_MESSAGE_TRIGGER: TriggerDeclaration<ZaloEventRow, ZaloMessageData> = {
    provider: PROVIDER.zaloOa,
    name: ZALO_MESSAGE_RECEIVED,
    verb: TRIGGER.zaloMessageReceived,
    // ONE event, two ways in (no webhook-only reason: Zalo documents no re-delivery, so the poll of the OA's inbox is the way a missed one comes back).
    via: ["webhook", "poll"],
    // The row both ways keep (a customer channel has no owner switch: it is on while its account is; no factKey: it declares a line).
    dataType: ZALO_EVENT_DATA_TYPE,
    words: ZALO_MESSAGE_WORDS,
    raw: ZALO_EVENT_ROW,
    data: ZALO_MESSAGE_DATA,
    translate: translateZaloEventRow,
    feeds: { stream: "lines", line: zaloLineOf },
    key: { by: "subject" },
    settle: CHAT_SETTLE,
    // The person's lines append to the route's stream: held lines are ONE marker the workflow reads the stream from (rule Q-4).
    combine: "stream",
}

/** Every trigger the Zalo OA provider declares. */
export const ZALO_TRIGGERS: ReadonlyArray<TriggerDeclaration<ZaloEventRow, ZaloMessageData>> = [ZALO_MESSAGE_TRIGGER]
