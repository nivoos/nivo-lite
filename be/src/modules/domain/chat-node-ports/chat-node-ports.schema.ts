import { lineOrderSchema } from "@nivo-lite/agent-sdk/node"
import { z } from "zod"
import type { CustomerMessageSend } from "./chat-node-ports.policy"

const ID_MAX = 100
const TEXT_MAX = 4000
const URL_MAX = 2000
const IMAGES_MAX = 10

const CAPTION_MAX = 500

/** The longest channel key a send may pick. */
const CHANNEL_MAX = 40

/** The longest address a send may name (a mail address: RFC 5321's path limit). */
const ADDRESS_MAX = 320

/** The longest subject line (as the workspace mailer cuts it). */
const SUBJECT_MAX = 200

/** The words and what the message shows, whatever it is addressed to. */
const content = {
    text: z.string().min(1).max(TEXT_MAX),
    subject: z.string().trim().min(1).max(SUBJECT_MAX).optional(),
    order: lineOrderSchema.optional(),
    images: z
        .array(z.object({ url: z.string().min(1).max(URL_MAX), caption: z.string().max(CAPTION_MAX) }))
        .max(IMAGES_MAX)
        .optional(),
}

/**
 * What the customer send carries: the words (and a subject line a channel may use), and the person, channel and account they go to (each
 * optional: the run's own person and woken route by default), or the ROUTE they go to (its person, channel and account; named alone), or
 * a person's own ADDRESS on a channel (named with that channel and no person: rule SO-3).
 */
export const customerMessageSendSchema: z.ZodType<CustomerMessageSend> = z
    .object({
        routeId: z.string().min(1).max(ID_MAX).optional(),
        contactId: z.string().min(1).max(ID_MAX).optional(),
        channel: z.string().min(1).max(CHANNEL_MAX).optional(),
        accountId: z.string().min(1).max(ID_MAX).optional(),
        address: z.string().trim().min(3).max(ADDRESS_MAX).optional(),
        ...content,
    })
    .refine(
        (send) =>
            send.routeId === undefined ||
            (send.contactId === undefined && send.channel === undefined && send.accountId === undefined && send.address === undefined),
        { path: ["routeId"] },
    )
    .refine((send) => send.address === undefined || (send.channel !== undefined && send.contactId === undefined), {
        path: ["address"],
    })
