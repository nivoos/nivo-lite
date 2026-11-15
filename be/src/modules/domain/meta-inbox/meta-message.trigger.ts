import { PROVIDER, TRIGGER, type TriggerVerb } from "@nivo-lite/agent-sdk/names"
import { z } from "zod"
import type { CustomerAttachment } from "@modules/domain/chat-files"
import type { DeclaredLine, OptionalCanonicalEvent, TriggerDeclaration } from "@modules/domain/provider-triggers"
import type { MetaEvent } from "@modules/integrations/meta"
import { isMetaEvent } from "./meta-account.policy"
import { metaEvent } from "./meta.data-types"

/** Facebook or Instagram, as the event names it. */
type MetaPlatform = MetaEvent["platform"]

/*
 * THE META CONNECTION'S TWO MESSAGE TRIGGERS (stage 1 of the one event pipeline, concept triggers rule 13): a direct message to a Facebook
 * Page or to an Instagram account, each its own verb, as ONE canonical event. Pure: the translate reads only its argument (the `meta.event`
 * row's event, normalised from Meta's webhook by the integration). A direct message with any content (words, or a content part with no
 * words: a picture, a voice note, a file) is a message: comments, mentions, postbacks and lead ads are dropped here (comments and the reply
 * window are kept by the receipt's own consumer, which wakes nothing).
 */

/** The trigger's name inside the provider. */
export const META_MESSAGE_RECEIVED = "message.received"

/** The data of one direct message (the channel message members of every channel, plus its content parts). */
export type MetaMessageData = {
    /** The key the line is stored once under: `meta:<event key>`. */
    readonly messageKey: string
    /** What the person wrote; empty for a message of content parts only (a picture, a voice note, a file, a location). */
    readonly text: string
    /**
     * Every content part of the message beside its words, as Meta names it (`kind` image for a picture, file for any other part), with
     * the address Meta gave (empty when none): the pipeline keeps each one or records it typed not-kept; empty for a message of words.
     */
    readonly attachments: ReadonlyArray<CustomerAttachment>
    /** When it was sent (ISO 8601). */
    readonly at: string | null
    /** Set only on the engine's release delivery of the channel verb (`held`): no new words. */
    readonly resume?: "held" | undefined
}

/** The `meta.event` row the webhook's receipt kept: the normalised event untouched in `raw`. The translate's raw. */
export interface MetaEventRow {
    /** The event's key, as the row keys it. */
    readonly eventKey: string
    /** The normalised event. */
    readonly raw: MetaEvent
}

/** Meta's type word of a picture; every other part with bytes is a file to the shop (its bytes decide whether it can be read). */
const META_IMAGE = "image"

/** Meta's part types that carry NO file, with their media type (standard IANA types): a shared place, a shared link. */
const TYPED_PARTS: ReadonlyMap<string, string> = new Map([
    ["location", "application/geo+json"],
    ["fallback", "text/uri-list"],
])

/**
 * The content parts of a message as the line keeps them: a picture or a file with the address Meta gave (empty when none: typed
 * not-kept downstream), or a typed part with no file (a place, a link) holding what Meta sent of it. None dropped for its kind.
 */
const partsOf = (event: MetaEvent): ReadonlyArray<CustomerAttachment> =>
    (event.attachments ?? []).map((part): CustomerAttachment => {
        const typed = TYPED_PARTS.get(part.type)
        if (typed !== undefined)
            return { kind: "file", url: "", name: [part.name, part.url].filter((one) => one !== null).join(" "), contentType: typed }
        return { kind: part.type === META_IMAGE ? "image" : "file", url: part.url ?? "", name: part.name ?? "" }
    })

/**
 * The direct message of one event on one platform, or null for any other event, another platform, no person, or a message with no
 * content at all (no words and no part). A message of parts only (a picture with no caption) IS a message: its line carries its files.
 */
const messageOf = (event: MetaEvent, platform: MetaPlatform): OptionalCanonicalEvent<MetaMessageData> => {
    const person = event.sender_psid ?? event.sender_igsid
    if (event.platform !== platform || event.kind !== "dm" || person === null) return null
    const text = event.text ?? ""
    const attachments = partsOf(event)
    if (text === "" && attachments.length === 0) return null
    return {
        id: event.event_key,
        subject: { channel: platform, id: person, ...(event.sender_name === null ? {} : { name: event.sender_name }) },
        data: {
            messageKey: `meta:${event.event_key}`,
            text,
            attachments,
            at: new Date(event.timestamp).toISOString(),
        },
    }
}

/** The data schema of a direct message. */
const META_MESSAGE_DATA: z.ZodType<MetaMessageData> = z.object({
    messageKey: z.string(),
    text: z.string(),
    attachments: z.array(
        z.object({ kind: z.enum(["image", "file"]), url: z.string(), name: z.string(), contentType: z.string().optional() }),
    ),
    at: z.string().nullable(),
    resume: z.literal("held").optional(),
})

/** The raw schema: the stored `meta.event` row value, its event a normalised Meta event. */
const META_EVENT_ROW: z.ZodType<MetaEventRow> = z.object({
    eventKey: z.string(),
    raw: z.custom<MetaEvent>((value) => isMetaEvent(value)),
})

/** A customer line settles: the run starts once the person has been quiet for 6 s, 20 s after their first line at most (customer-messages rule 13). */
const CHAT_SETTLE = { windowMs: 6000, maxWaitMs: 20_000 } as const

/** The declaration of one platform's message trigger. */
/**
 * The line the person said, as the engine keeps it on the route (owner ruling R26): the message key, the words, the channel's time. The
 * release door's delivery carries no key and is no line. Pure.
 */
export const metaLineOf = (data: MetaMessageData): DeclaredLine | null =>
    data.messageKey === "" ? null : { key: data.messageKey, text: data.text, at: data.at }

/** What the owner's pages call each platform, by the platform's own word. */
const PLATFORM_WORDS: Readonly<Record<MetaPlatform, TriggerDeclaration["words"]["title"]>> = {
    facebook: { vi: "Facebook", en: "Facebook" },
    instagram: { vi: "Instagram", en: "Instagram" },
}

const messageTriggerOf = (platform: MetaPlatform, verb: TriggerVerb): TriggerDeclaration<MetaEventRow, MetaMessageData> => ({
    provider: PROVIDER.meta,
    name: `${platform}.${META_MESSAGE_RECEIVED}`,
    verb,
    via: ["webhook"],
    // Verified 2026-11-14 (developers.facebook.com/docs/graph-api/webhooks/getting-started): a failed delivery is retried "immediately", then
    // "a few more times with decreasing frequency over the next 36 hours"; after that it is dropped. NOT VERIFIED: that the Conversations API
    // message id equals the webhook `mid` (the `meta.event` row key is `dm:<mid>`), so no poll receiver is built (a wrong key would store
    // every polled message twice); see the TL-S2 finding in R4-NOTES.
    withoutPoll: {
        reason: {
            vi: "Meta gửi lại ngay khi lỗi, rồi thưa dần trong 36 giờ; quá hạn đó thì bỏ. Chưa có cách đọc lại tin theo cùng mã tin.",
            en: "Meta retries a failed delivery at once, then with decreasing frequency over 36 hours, then drops it; no read-back by the same message key is verified.",
        },
        source: "https://developers.facebook.com/docs/graph-api/webhooks/getting-started",
    },
    words: {
        title: { vi: `${PLATFORM_WORDS[platform].vi} · Tin nhắn đến`, en: `${PLATFORM_WORDS[platform].en} · Message received` },
        summary: {
            vi: `Một người nhắn trực tiếp cho ${platform === "facebook" ? "Trang Facebook" : "tài khoản Instagram"} của bạn.`,
            en: `A person sends a direct message to your ${platform === "facebook" ? "Facebook Page" : "Instagram account"}.`,
        },
        members: {
            messageKey: { vi: "Mã tin nhắn", en: "The message's key" },
            text: { vi: "Nội dung người đó viết", en: "What the person wrote" },
            attachments: { vi: "Ảnh và tệp người đó gửi", en: "The pictures and files the person sent" },
            at: { vi: "Thời điểm gửi", en: "When it was sent" },
        },
    },
    dataType: metaEvent.name,
    raw: META_EVENT_ROW,
    data: META_MESSAGE_DATA,
    translate: (row) => messageOf(row.raw, platform),
    feeds: { stream: "lines", line: metaLineOf },
    key: { by: "subject" },
    settle: CHAT_SETTLE,
    // The person's lines append to the route's stream: held lines are ONE marker the workflow reads the stream from (rule Q-4).
    combine: "stream",
})

/** A Facebook Page's direct message. */
export const FACEBOOK_MESSAGE_WEBHOOK: TriggerDeclaration<MetaEventRow, MetaMessageData> = messageTriggerOf(
    "facebook",
    TRIGGER.facebookMessageReceived,
)

/** An Instagram account's direct message. */
export const INSTAGRAM_MESSAGE_WEBHOOK: TriggerDeclaration<MetaEventRow, MetaMessageData> = messageTriggerOf(
    "instagram",
    TRIGGER.instagramMessageReceived,
)

/** Every trigger the Meta provider declares. */
export const META_TRIGGERS: ReadonlyArray<TriggerDeclaration<MetaEventRow, MetaMessageData>> = [
    FACEBOOK_MESSAGE_WEBHOOK,
    INSTAGRAM_MESSAGE_WEBHOOK,
]

/** The declaration of the event's platform (the provider's own `platform` field), the one whose translate may answer the row. */
export const metaMessageTriggerOf = (row: MetaEventRow): TriggerDeclaration<MetaEventRow, MetaMessageData> =>
    row.raw.platform === "instagram" ? INSTAGRAM_MESSAGE_WEBHOOK : FACEBOOK_MESSAGE_WEBHOOK
