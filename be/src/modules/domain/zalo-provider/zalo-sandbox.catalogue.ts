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
import type { OptionalChannelProfile } from "@modules/domain/provider-registry"

/** The provider key of the Zalo OA catalogue. */
export const ZALO_SANDBOX_PROVIDER = "zalo_oa"

/** One customer of the sandbox OA: Zalo's id of the person, the name and the picture the profile read answers. */
export interface ZaloSandboxCustomer {
    readonly userId: string
    readonly name: string
    readonly picture: string
}

/** The customers of the sandbox OA (fixed ids; the same on every machine). */
export const ZALO_SANDBOX_CUSTOMERS: ReadonlyArray<ZaloSandboxCustomer> = [
    { userId: "8800110022", name: "Nguyen Van An", picture: "https://sandbox.invalid/zalo/an.jpg" },
    { userId: "8800110033", name: "Tran Thi Binh", picture: "https://sandbox.invalid/zalo/binh.jpg" },
    { userId: "8800110044", name: "Le Minh Chi", picture: "https://sandbox.invalid/zalo/chi.jpg" },
    { userId: "8800110055", name: "Pham Quoc Dung", picture: "https://sandbox.invalid/zalo/dung.jpg" },
]

/** The profile case that makes the read say nothing (null) for everyone. */
export const ZALO_PROFILE_NONE_CASE = "ZALO-5"

/** The operation of the profile read in the sandbox call log and in the account's next-case selector. */
export const ZALO_PROFILE_OPERATION = "profileOf"

/** What the catalogue says of one person: the customer's name and picture, null for a person the OA does not know (as the live read answers a refusal). */
export const zaloSandboxProfileOf = (personId: string): OptionalChannelProfile => {
    const customer = ZALO_SANDBOX_CUSTOMERS.find((one) => one.userId === personId)
    return customer === undefined ? null : { name: customer.name, picture: customer.picture }
}

/** What a customer sends the OA: a text, a picture, a file, a video, a voice message or a sticker (Zalo's events `user_send_<kind>`). */
export type ZaloSandboxKind = "text" | "photo" | "file" | "video" | "audio" | "sticker"

/** The event name and the one attachment each non-text kind posts, in Zalo's own webhook shapes (the address is the sandbox's, never Zalo's). */
const ZALO_ATTACHMENT_OF: Readonly<
    Record<Exclude<ZaloSandboxKind, "text">, (message: ZaloSandboxMessage) => { readonly event: string; readonly attachment: unknown }>
> = {
    photo: () => ({
        event: "user_send_image",
        attachment: { type: "image", payload: { thumbnail: "https://sandbox.invalid/zalo/photo.jpg", url: "https://sandbox.invalid/zalo/photo.jpg" } },
    }),
    file: (message) => ({
        event: "user_send_file",
        attachment: {
            type: "file",
            payload: { url: "https://sandbox.invalid/zalo/file.pdf", name: message.fileName ?? "file.pdf", size: "48600", checksum: "sandbox-checksum", type: "pdf" },
        },
    }),
    video: () => ({
        event: "user_send_video",
        attachment: {
            type: "video",
            payload: { thumbnail: "https://sandbox.invalid/zalo/video.jpg", description: "", url: "https://sandbox.invalid/zalo/video.mp4" },
        },
    }),
    audio: () => ({ event: "user_send_audio", attachment: { type: "audio", payload: { url: "https://sandbox.invalid/zalo/voice.aac" } } }),
    sticker: () => ({
        event: "user_send_sticker",
        attachment: { type: "sticker", payload: { id: "sandbox-sticker", url: "https://sandbox.invalid/zalo/sticker.png" } },
    }),
}

/** One customer message the account's cases made, as the OA's chat list reports it and as the webhook delivered it. */
export interface ZaloSandboxMessage {
    /** Zalo's id of the message (`msg_id`, `sbx-zmsg-000001` running per account). */
    readonly messageId: string
    /** The customer who wrote it. */
    readonly userId: string
    /** The kind the chat list reports: `text` or `photo`. */
    readonly kind: ZaloSandboxKind
    /** The text; empty for anything but a text. */
    readonly text: string
    /** The file name of a `file` message (`payload.name`); absent for every other kind. */
    readonly fileName?: string | undefined
    /** When Zalo stamped it, epoch milliseconds. */
    readonly sentAt: number
}

/** The state name the messages the account's cases made are kept under (key `""`, an array of `ZaloSandboxMessage`, oldest first): the poll answers them. */
export const ZALO_SANDBOX_MESSAGES_STATE = "messages"

/**
 * The state name of what Zalo remembers of each customer's last line: key = the customer's `userId`, value = epoch milliseconds (a
 * number) of the Zalo timestamp of the customer's latest message. Written by ZALO-1..3, read back by `zaloLastLineAt` (the customer-send
 * sandbox answers `outside_window` when the line is more than 48 hours older than the send).
 */
export const ZALO_SANDBOX_LAST_LINE_STATE = "last-line"

/** How far before the send's moment the Zalo timestamp of ZALO-3 lies: 49 hours, one hour outside the reply window. */
export const ZALO_SANDBOX_STALE_AGE_MS = 49 * 3_600_000

/** The webhook route of a Zalo OA on NIVO for one account. */
const zaloRoute = (connectionId: string): string => `api/connections/zalo/${connectionId}`

/** The id of the account's next message: `sbx-zmsg-000001` for the first inbound send of the account. */
const messageIdOf = (seq: number): string => `sbx-zmsg-${String(seq + 1).padStart(6, "0")}`

/** The body Zalo's webhook posts for one message (its real event names and members). */
export const zaloWebhookBodyOf = (message: ZaloSandboxMessage): Readonly<Record<string, unknown>> => {
    const attachment = message.kind === "text" ? null : ZALO_ATTACHMENT_OF[message.kind](message)
    return {
        app_id: "sandbox-app",
        user_id_by_app: message.userId,
        event_name: attachment === null ? "user_send_text" : attachment.event,
        timestamp: String(message.sentAt),
        sender: { id: message.userId },
        recipient: { id: "sandbox-oa" },
        message:
            attachment === null
                ? { msg_id: message.messageId, text: message.text }
                : { msg_id: message.messageId, attachments: [attachment.attachment] },
    }
}

/** The messages an account's cases made, oldest first (empty for a new account). */
export const zaloMessagesOf = (kept: unknown): ReadonlyArray<ZaloSandboxMessage> =>
    Array.isArray(kept) ? kept.filter((one): one is ZaloSandboxMessage => typeof one === "object" && one !== null && "messageId" in one) : []

/** The Zalo timestamp (epoch ms) of the customer's last line as the account's state holds it, or null when the customer never wrote. */
export const zaloLastLineAt = async (state: Pick<SandboxState, "read">, userId: string): Promise<number | null> => {
    const kept = await state.read(ZALO_SANDBOX_LAST_LINE_STATE, userId)
    return typeof kept === "number" ? kept : null
}

/** The input naming the person (ZALO-1..3). */
const USER_FIELD: SandboxInputField = { name: "userId", label: "Zalo ID của khách / Zalo id of the person", kind: "text", example: "8800110022" }

/** The input holding the line the person writes (ZALO-1 and ZALO-3). */
const TEXT_FIELD: SandboxInputField = { name: "text", label: "Nội dung tin / Message text", kind: "text", example: "Chao shop, cho minh hoi gia bo hoa hong do nhe" }

/** The input naming the file of a file message (ZALO-6). */
const FILE_NAME_FIELD: SandboxInputField = { name: "fileName", label: "Tên tệp / File name", kind: "text", example: "bao-gia.pdf" }

/** What one inbound case does: the kind of message the customer sends. */
interface ZaloMessagePlan {
    readonly kind: ZaloSandboxKind
}

/**
 * One Zalo follow / unfollow event: the person follows or stops following the OA. Zalo's door keeps the person with their follow state
 * (`follower.id`, else `sender.id`: zalo.normalise.policy) and makes no line, so nothing is kept in the account's state.
 */
const followCase = (event: "follow" | "unfollow"): SandboxInboundCase => ({
    trigger: "message.received",
    path: zaloRoute,
    inputs: [USER_FIELD],
    eventsOf: (input: SandboxInput, context: SandboxInboundContext): Promise<ReadonlyArray<SandboxWebhookEvent>> =>
        Promise.resolve([
            {
                body: {
                    app_id: "sandbox-app",
                    user_id_by_app: typeof input.userId === "string" ? input.userId : "",
                    event_name: event,
                    timestamp: String(context.at.getTime()),
                    oa_id: "sandbox-oa",
                    follower: { id: typeof input.userId === "string" ? input.userId : "" },
                },
            },
        ]),
})

/**
 * One Zalo inbound case: a customer's message becomes ONE webhook body (id from the account's running number, stamped `at - age`), kept
 * in the account's state (the message for the poll, the time of the customer's last line).
 */
const caseOf = (
    plan: ZaloMessagePlan,
    inputs: ReadonlyArray<SandboxInputField>,
    extra: Pick<SandboxInboundCase, "polled" | "delivery"> = {},
): SandboxInboundCase => ({
    trigger: "message.received",
    path: zaloRoute,
    inputs,
    ...extra,
    eventsOf: async (input: SandboxInput, context: SandboxInboundContext): Promise<ReadonlyArray<SandboxWebhookEvent>> => {
        const sentAt = context.at.getTime()
        const message: ZaloSandboxMessage = {
            messageId: messageIdOf(context.state.seq),
            userId: typeof input.userId === "string" ? input.userId : "",
            kind: plan.kind,
            text: plan.kind === "text" && typeof input.text === "string" ? input.text : "",
            ...(plan.kind === "file" && typeof input.fileName === "string" ? { fileName: input.fileName } : {}),
            sentAt,
        }
        const kept = zaloMessagesOf(await context.state.read(ZALO_SANDBOX_MESSAGES_STATE, ""))
        await context.state.write(ZALO_SANDBOX_MESSAGES_STATE, "", [...kept, message])
        await context.state.write(ZALO_SANDBOX_LAST_LINE_STATE, message.userId, sentAt)
        return [{ body: zaloWebhookBodyOf(message) }]
    },
})

/**
 * Zalo OA's hardcoded sandbox cases (owner ruling R62): three inbound TRANSFORMATIONS of `{ userId, text }` into the body Zalo posts on
 * `api/connections/zalo/<connectionId>` (a text line, a picture with no text, a text line stamped 49 hours before the send: outside
 * the 48-hour reply window), and the profile read of a known and of an unknown person. State kept: `messages` (the poll answers them) and
 * `last-line` (see `ZALO_SANDBOX_LAST_LINE_STATE`). The customer SEND answers from `zalo-sandbox-send.catalogue.ts` (ZALO-SEND-1..4).
 */
export const ZALO_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: ZALO_SANDBOX_PROVIDER,
    cases: [
        {
            id: "ZALO-1",
            label: "A customer writes a text line: user_send_text stamped at the send",
            inbound: caseOf({ kind: "text" }, [USER_FIELD, TEXT_FIELD], { polled: true }),
        },
        {
            id: "ZALO-2",
            label: "A customer sends a picture and no text: user_send_image stamped at the send",
            inbound: caseOf({ kind: "photo" }, [USER_FIELD]),
        },
        {
            id: "ZALO-3",
            label: "A customer's text line stamped 49 hours before the send: outside the 48-hour reply window, a later customer send is refused",
            // A thin NAME over the generic `late` delivery: ZALO-1 that happened 49 hours before it arrives.
            inbound: caseOf({ kind: "text" }, [USER_FIELD, TEXT_FIELD], {
                polled: true,
                delivery: { mode: "late", lateBySeconds: ZALO_SANDBOX_STALE_AGE_MS / 1_000 },
            }),
        },
        {
            id: "ZALO-4",
            label: "Profile of a person: the customer's name and picture link, null for a person the OA does not know",
            operation: ZALO_PROFILE_OPERATION,
            default: true,
            outcome: "ok",
        },
        {
            id: "ZALO-5",
            label: "Profile read says nothing (null), whoever the person is",
            operation: ZALO_PROFILE_OPERATION,
            outcome: "refused",
        },
        {
            id: "ZALO-6",
            label: "A customer sends a file: user_send_file with a file attachment (url, name, size, checksum, type) and no text",
            inbound: caseOf({ kind: "file" }, [USER_FIELD, FILE_NAME_FIELD]),
        },
        {
            id: "ZALO-7",
            label: "A customer sends a video: user_send_video (a kind NIVO's message trigger does not read: no line is made)",
            inbound: caseOf({ kind: "video" }, [USER_FIELD]),
        },
        {
            id: "ZALO-8",
            label: "A customer sends a voice message: user_send_audio (a kind NIVO's message trigger does not read: no line is made)",
            inbound: caseOf({ kind: "audio" }, [USER_FIELD]),
        },
        {
            id: "ZALO-9",
            label: "A customer sends a sticker: user_send_sticker (a kind NIVO's message trigger does not read: no line is made)",
            inbound: caseOf({ kind: "sticker" }, [USER_FIELD]),
        },
        {
            id: "ZALO-10",
            label: "A person follows the OA: the follow event (follower.id); the door keeps the person, no line is made",
            inbound: followCase("follow"),
        },
        {
            id: "ZALO-11",
            label: "A person stops following the OA: the unfollow event; the door keeps the person's follow state, no line is made",
            inbound: followCase("unfollow"),
        },
        {
            id: "ZALO-12",
            label: "The profile read fails \"not now\" (429 / 5xx): nothing read, the engine may ask again",
            operation: ZALO_PROFILE_OPERATION,
            outcome: "transient",
        },
        {
            id: "ZALO-13",
            label: "The profile read gets no answer in time: the outcome is unknown",
            operation: ZALO_PROFILE_OPERATION,
            outcome: "timeout",
        },
    ] satisfies ReadonlyArray<SandboxCase>,
}
