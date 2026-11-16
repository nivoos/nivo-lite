import type {
    SandboxCase,
    SandboxCatalogue,
    SandboxInboundCase,
    SandboxInboundContext,
    SandboxInput,
    SandboxInputField,
    SandboxState,
    SandboxWebhookEvent,
} from "@modules/domain/provider-sandbox"

/** The provider key of the Meta (Facebook Page and Instagram) catalogue: `connections.provider` names it so. */
export const META_SANDBOX_PROVIDER = "meta"

/** The Facebook Page id the sandbox account's Messenger events name (`entry[].id`, `recipient.id`). */
export const META_SANDBOX_PAGE_ID = "sandbox-page"

/** The Instagram account id the sandbox account's Instagram events name. */
export const META_SANDBOX_IG_ID = "sandbox-ig"

/** Meta's reply window: 24 hours after the person's last message (the standard messaging window). */
export const META_REPLY_WINDOW_MS = 24 * 3_600_000

/** How far before the send's moment the stamp of a line outside the window lies: 25 hours, one hour outside the reply window. */
export const META_SANDBOX_STALE_AGE_MS = 25 * 3_600_000

/**
 * The state name of what Meta remembers of each person's last line: key = the person's id (`psid`), value = epoch milliseconds (a number)
 * of the timestamp of the person's latest message. Written by every inbound case that is a direct message, read back by `metaLastLineAt`
 * (the customer-send sandbox refuses when the line is more than 24 hours older than the send).
 */
export const META_SANDBOX_LAST_LINE_STATE = "last-line"

/**
 * The webhook route of the sandbox door of the Meta app webhook for one account. Meta's real webhook is app-wide (one URL for every
 * Page, signed with the app secret) and names no connection, so a sandbox account has its own door beside it that names the account and
 * proves it with the sandbox key; a live account is never accepted there.
 */
const metaRoute = (connectionId: string): string => `api/connections/meta/webhook/${connectionId}`

/** The Meta timestamp (epoch ms) of the person's last line as the account's state holds it, or null when the person never wrote. */
export const metaLastLineAt = async (state: Pick<SandboxState, "read">, personId: string): Promise<number | null> => {
    const kept = await state.read(META_SANDBOX_LAST_LINE_STATE, personId)
    return typeof kept === "number" ? kept : null
}

/** The input naming the person (every case): the Page-scoped id of a Messenger user, or the Instagram-scoped id. */
const PERSON_FIELD: SandboxInputField = { name: "psid", label: "ID của khách / Id of the person", kind: "text", example: "7700110022" }

/** The input holding the line the person writes. */
const TEXT_FIELD: SandboxInputField = {
    name: "text",
    label: "Nội dung tin / Message text",
    kind: "text",
    example: "Chao shop, cho minh hoi gia bo hoa hong do nhe",
}

/** The input holding the payload of a quick reply or a postback button. */
const PAYLOAD_FIELD: SandboxInputField = { name: "payload", label: "Payload của nút / The button's payload", kind: "text", example: "GET_PRICE" }

/** The input holding a postback button's title. */
const TITLE_FIELD: SandboxInputField = { name: "title", label: "Chữ trên nút / The button's title", kind: "text", example: "Xem giá" }

/** The input holding the Meta attachment type of a non-picture attachment (the live parser reads only that the list is not empty). */
const ATTACHMENT_TYPE_FIELD: SandboxInputField = { name: "type", label: "Loại tệp đính kèm / Attachment type", kind: "text", example: "audio" }

/** The input holding the words of a comment or a mention. */
const COMMENT_FIELD: SandboxInputField = { name: "text", label: "Nội dung bình luận / Comment text", kind: "text", example: "Bo hoa nay con khong shop oi" }

/** What a Meta event is: the platform it comes in on and the shape of what the person (or Meta) sent. */
type MetaShape =
    | "text"
    | "photo"
    | "attachment"
    | "quick_reply"
    | "postback"
    | "echo"
    | "delivery"
    | "comment"
    | "mention"
    | "leadgen"
    | "malformed"

/** What one inbound case does: the platform, the shape and how long before the send the stamp lies. */
interface MetaMessagePlan {
    readonly platform: "facebook" | "instagram"
    readonly shape: MetaShape
    readonly ageMs: number
}

/** The shapes that are a direct message of the person: they open the reply window (the account's `last-line` state). */
const DIRECT_MESSAGE_SHAPES: ReadonlySet<MetaShape> = new Set<MetaShape>(["text", "photo", "attachment", "quick_reply"])

/** The id of the account's next message: `sbx-mid-000001` for the first inbound send of the account. */
const messageIdOf = (seq: number): string => `sbx-mid-${String(seq + 1).padStart(6, "0")}`

/** The text of an input (a number is its digits, an absent input is empty). */
const textOf = (value: SandboxInput[string] | undefined): string => (typeof value === "string" ? value : String(value ?? ""))

/**
 * The `messaging[]` item of a direct-message or postback shape, in the words `integrations/meta/meta-webhook.policy.ts` `fromMessaging`
 * reads (spec: `meta-webhook.policy.spec.ts`): `sender.id`, `recipient.id`, `timestamp` (ms), and `message` (`mid`, `text`, `attachments`,
 * `quick_reply.payload`, `is_echo`), or `postback` (`mid`, `payload`, `title`), or a `delivery` receipt (`watermark`).
 */
const messagingItemOf = (plan: MetaMessagePlan, input: SandboxInput, mid: string, sentAt: number, surfaceId: string): Record<string, unknown> => {
    const personId = textOf(input.psid)
    const item = { sender: { id: personId }, recipient: { id: surfaceId }, timestamp: sentAt }
    switch (plan.shape) {
        case "text":
            return { ...item, message: { mid, text: textOf(input.text) } }
        case "photo":
            return { ...item, message: { mid, attachments: [{ type: "image", payload: { url: `https://sandbox.invalid/${mid}.jpg` } }] } }
        case "attachment":
            return { ...item, message: { mid, attachments: [{ type: textOf(input.type), payload: { url: `https://sandbox.invalid/${mid}.bin` } }] } }
        case "quick_reply":
            return { ...item, message: { mid, quick_reply: { payload: textOf(input.payload) } } }
        case "postback":
            return { ...item, postback: { mid, payload: textOf(input.payload), title: textOf(input.title) } }
        case "echo":
            // The Page's own send reflected back: the parser drops `is_echo` (and any sender that is the entry itself).
            return { sender: { id: surfaceId }, recipient: { id: personId }, timestamp: sentAt, message: { mid, text: textOf(input.text), is_echo: true } }
        case "delivery":
            return { ...item, delivery: { watermark: sentAt } }
        default:
            return item
    }
}

/**
 * The `changes[]` item of a comment, mention or lead-ad shape, in the words `fromFacebookChange` / `fromInstagramChange` read: Facebook
 * `feed` (`item: "comment"`, `verb: "add"`, `comment_id`, `post_id`, `message`, `from`, `created_time` in seconds), `mention`, `leadgen`
 * (`leadgen_id`, `page_id`, `form_id`, `ad_id`, `created_time`); Instagram `comments` (`id`, `text`, `from.id`, `from.username`,
 * `media.id`) and `mentions` (`comment_id`, `media_id`).
 */
const changeOf = (plan: MetaMessagePlan, input: SandboxInput, mid: string, sentAt: number, surfaceId: string): Record<string, unknown> => {
    const personId = textOf(input.psid)
    const seconds = Math.floor(sentAt / 1000)
    const key = mid.replace("sbx-mid-", "")
    if (plan.platform === "facebook") {
        if (plan.shape === "comment") {
            return {
                field: "feed",
                value: {
                    item: "comment",
                    verb: "add",
                    comment_id: `sbx-comment-${key}`,
                    post_id: `${surfaceId}_sbx-post`,
                    message: textOf(input.text),
                    from: { id: personId, name: "Khách thử nghiệm" },
                    created_time: seconds,
                },
            }
        }
        if (plan.shape === "mention") {
            return { field: "mention", value: { verb: "add", post_id: `${surfaceId}_sbx-post-${key}`, message: textOf(input.text), created_time: seconds } }
        }
        return { field: "leadgen", value: { leadgen_id: `sbx-lead-${key}`, page_id: surfaceId, form_id: "sbx-form", ad_id: "sbx-ad", created_time: seconds } }
    }
    if (plan.shape === "comment") {
        return {
            field: "comments",
            value: { id: `sbx-comment-${key}`, text: textOf(input.text), from: { id: personId, username: "khach_thu_nghiem" }, media: { id: "sbx-media" } },
        }
    }
    return { field: "mentions", value: { comment_id: `sbx-comment-${key}`, media_id: "sbx-media" } }
}

/** The shapes that arrive as a `changes[]` item, not a `messaging[]` one. */
const CHANGE_SHAPES: ReadonlySet<MetaShape> = new Set<MetaShape>(["comment", "mention", "leadgen"])

/**
 * One Meta inbound case: an event becomes ONE webhook body as Meta posts it (`object` `page` or `instagram`, one `entry` with one
 * `messaging` item or one `changes` item), stamped `at - age`; a direct message is kept in the account's state as the person's last line.
 * The `malformed` shape posts a body that is no JSON object (an array): the door refuses it `META_INBOX_DELIVERY_INVALID`
 * (`meta-inbox.service.ts` `eventsOf`) before anything is kept.
 */
const caseOf = (plan: MetaMessagePlan, inputs: ReadonlyArray<SandboxInputField>): SandboxInboundCase => ({
    trigger: plan.shape === "text" || plan.shape === "photo" || plan.shape === "attachment" || plan.shape === "quick_reply" ? `${plan.platform}.message.received` : "meta.event",
    path: metaRoute,
    inputs,
    eventsOf: async (input: SandboxInput, context: SandboxInboundContext): Promise<ReadonlyArray<SandboxWebhookEvent>> => {
        if (plan.shape === "malformed") return [{ body: [] }]
        const sentAt = context.at.getTime() - plan.ageMs
        const surfaceId = plan.platform === "facebook" ? META_SANDBOX_PAGE_ID : META_SANDBOX_IG_ID
        const mid = messageIdOf(context.state.seq)
        if (DIRECT_MESSAGE_SHAPES.has(plan.shape)) await context.state.write(META_SANDBOX_LAST_LINE_STATE, textOf(input.psid), sentAt)
        const entry = CHANGE_SHAPES.has(plan.shape)
            ? { id: surfaceId, time: Math.floor(sentAt / 1000), changes: [changeOf(plan, input, mid, sentAt, surfaceId)] }
            : { id: surfaceId, time: Math.floor(sentAt / 1000), messaging: [messagingItemOf(plan, input, mid, sentAt, surfaceId)] }
        return [{ body: { object: plan.platform === "facebook" ? "page" : "instagram", entry: [entry] } }]
    },
})

/** The ids of the inbound cases by what they send, so specs and the coverage name no bare number. */
export const META_INBOUND_CASE = {
    facebookText: "META-1",
    facebookPhoto: "META-2",
    facebookStale: "META-3",
    instagramText: "META-4",
    instagramPhoto: "META-5",
    instagramStale: "META-6",
    facebookQuickReply: "META-7",
    instagramQuickReply: "META-8",
    facebookAttachment: "META-9",
    instagramAttachment: "META-10",
    facebookPostback: "META-11",
    instagramPostback: "META-12",
    facebookEcho: "META-13",
    facebookDelivery: "META-14",
    facebookComment: "META-15",
    instagramComment: "META-16",
    facebookLead: "META-17",
    facebookMention: "META-18",
    instagramMention: "META-19",
    malformed: "META-20",
} as const

/**
 * Meta's hardcoded sandbox cases (owner ruling R62): inbound TRANSFORMATIONS of `{ psid, text }` and the like into the body Meta posts
 * (Messenger `object: "page"`, Instagram `object: "instagram"`, `entry[].messaging[]` or `entry[].changes[]`) to the sandbox door of the app
 * webhook, `api/connections/meta/webhook/<connectionId>`. Every shape is one the live parser reads (`meta-webhook.policy.ts`, its spec):
 * a text line, a picture with no text, a non-picture attachment, a quick reply, a postback button, the Page's own echo, a delivery receipt,
 * a comment, a mention, a lead ad, and a text line stamped 25 hours before the send (outside the 24-hour reply window, a later customer
 * send is refused). `META-20` is a body the door refuses. State kept: `last-line`. The customer SEND answers from
 * `meta-sandbox-send.catalogue.ts` (META-SEND-n). A first contact is any `psid` the account never wrote with; Meta has no poll of
 * messages (the triggers declare `withoutPoll`), so no case is `polled`.
 */
export const META_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: META_SANDBOX_PROVIDER,
    cases: [
        {
            id: "META-1",
            label: "Messenger: a person writes the Page a text line, stamped at the send",
            inbound: caseOf({ platform: "facebook", shape: "text", ageMs: 0 }, [PERSON_FIELD, TEXT_FIELD]),
        },
        {
            id: "META-2",
            label: "Messenger: a person sends the Page a picture and no text, stamped at the send",
            inbound: caseOf({ platform: "facebook", shape: "photo", ageMs: 0 }, [PERSON_FIELD]),
        },
        {
            id: "META-3",
            label: "Messenger: a person's text line stamped 25 hours before the send: outside the 24-hour reply window, a later customer send is refused",
            inbound: caseOf({ platform: "facebook", shape: "text", ageMs: META_SANDBOX_STALE_AGE_MS }, [PERSON_FIELD, TEXT_FIELD]),
        },
        {
            id: "META-4",
            label: "Instagram: a person writes the account a text line, stamped at the send",
            inbound: caseOf({ platform: "instagram", shape: "text", ageMs: 0 }, [PERSON_FIELD, TEXT_FIELD]),
        },
        {
            id: "META-5",
            label: "Instagram: a person sends the account a picture and no text, stamped at the send",
            inbound: caseOf({ platform: "instagram", shape: "photo", ageMs: 0 }, [PERSON_FIELD]),
        },
        {
            id: "META-6",
            label: "Instagram: a person's text line stamped 25 hours before the send: outside the 24-hour reply window, a later customer send is refused",
            inbound: caseOf({ platform: "instagram", shape: "text", ageMs: META_SANDBOX_STALE_AGE_MS }, [PERSON_FIELD, TEXT_FIELD]),
        },
        {
            id: "META-7",
            label: "Messenger: a person taps a quick reply (a message with a quick-reply payload and no text): the payload is the line",
            inbound: caseOf({ platform: "facebook", shape: "quick_reply", ageMs: 0 }, [PERSON_FIELD, PAYLOAD_FIELD]),
        },
        {
            id: "META-8",
            label: "Instagram: a person taps a quick reply (a message with a quick-reply payload and no text): the payload is the line",
            inbound: caseOf({ platform: "instagram", shape: "quick_reply", ageMs: 0 }, [PERSON_FIELD, PAYLOAD_FIELD]),
        },
        {
            id: "META-9",
            label: "Messenger: a person sends a non-picture attachment (audio, video, file: the type is the sender's) and no text",
            inbound: caseOf({ platform: "facebook", shape: "attachment", ageMs: 0 }, [PERSON_FIELD, ATTACHMENT_TYPE_FIELD]),
        },
        {
            id: "META-10",
            label: "Instagram: a person sends a non-picture attachment (audio, video, file: the type is the sender's) and no text",
            inbound: caseOf({ platform: "instagram", shape: "attachment", ageMs: 0 }, [PERSON_FIELD, ATTACHMENT_TYPE_FIELD]),
        },
        {
            id: "META-11",
            label: "Messenger: a person taps a button of the Page's message (a postback): an event, no line",
            inbound: caseOf({ platform: "facebook", shape: "postback", ageMs: 0 }, [PERSON_FIELD, PAYLOAD_FIELD, TITLE_FIELD]),
        },
        {
            id: "META-12",
            label: "Instagram: a person taps a button of the account's message (a postback): an event, no line",
            inbound: caseOf({ platform: "instagram", shape: "postback", ageMs: 0 }, [PERSON_FIELD, PAYLOAD_FIELD, TITLE_FIELD]),
        },
        {
            id: "META-13",
            label: "Messenger: Meta reflects the Page's own message back (an echo): accepted by the door, no line",
            inbound: caseOf({ platform: "facebook", shape: "echo", ageMs: 0 }, [PERSON_FIELD, TEXT_FIELD]),
        },
        {
            id: "META-14",
            label: "Messenger: Meta reports a message delivered (a delivery receipt with a watermark): accepted by the door, no line",
            inbound: caseOf({ platform: "facebook", shape: "delivery", ageMs: 0 }, [PERSON_FIELD]),
        },
        {
            id: "META-15",
            label: "Facebook: a person comments on a Page post: a comment event for the Page's comment intake, no direct message",
            inbound: caseOf({ platform: "facebook", shape: "comment", ageMs: 0 }, [PERSON_FIELD, COMMENT_FIELD]),
        },
        {
            id: "META-16",
            label: "Instagram: a person comments on the account's media: a comment event for the comment intake, no direct message",
            inbound: caseOf({ platform: "instagram", shape: "comment", ageMs: 0 }, [PERSON_FIELD, COMMENT_FIELD]),
        },
        {
            id: "META-17",
            label: "Facebook: a person fills a lead ad form (a leadgen notification with a lead id): an event, no direct message",
            inbound: caseOf({ platform: "facebook", shape: "leadgen", ageMs: 0 }, [PERSON_FIELD]),
        },
        {
            id: "META-18",
            label: "Facebook: the Page is mentioned in a post (a mention event): no direct message",
            inbound: caseOf({ platform: "facebook", shape: "mention", ageMs: 0 }, [PERSON_FIELD, COMMENT_FIELD]),
        },
        {
            id: "META-19",
            label: "Instagram: the account is mentioned in a comment or a media (a mention event): no direct message",
            inbound: caseOf({ platform: "instagram", shape: "mention", ageMs: 0 }, [PERSON_FIELD]),
        },
        {
            id: "META-20",
            label: "A delivery whose body is no JSON object (an array): the door refuses it META_INBOX_DELIVERY_INVALID and keeps nothing",
            inbound: caseOf({ platform: "facebook", shape: "malformed", ageMs: 0 }, []),
        },
    ] satisfies ReadonlyArray<SandboxCase>,
}
