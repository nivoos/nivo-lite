import { z } from "zod"
import type { ImapMailRow, MailReceivedData } from "./imap-mail.trigger"

/** The longest id, folder name or `Message-ID` the mailbox trigger accepts (the RFC 5322 line limit is 998; folder names stay far below). */
const MAIL_TEXT_MAX = 1000

/** The longest ISO time text the mailbox trigger accepts. */
const MAIL_TIME_MAX = 64

/** The longest subject and the longest text of a mail the row keeps (data-records `IMAP_SUBJECT_MAX`, `IMAP_MAIL_TEXT_MAX`). */
const MAIL_SUBJECT_MAX = 2000
const MAIL_BODY_MAX = 20 * 1024

/** The longest line text: the subject, a blank line and the text. */
const MAIL_LINE_MAX = MAIL_SUBJECT_MAX + 2 + MAIL_BODY_MAX

/** The most thread ids and file names an event carries. */
const MAIL_LIST_MAX = 200

/** The longest raw header text kept of `Auto-Submitted`, `Precedence` and `Return-Path`. */
const MAIL_HEADER_MAX = 400

/** The shape of a stored `imap.mail` row the trigger's translate reads (version 2). */
export const IMAP_MAIL_ROW_SCHEMA: z.ZodType<ImapMailRow> = z.object({
    externalId: z.string().max(MAIL_TEXT_MAX),
    folder: z.string().max(MAIL_TEXT_MAX),
    uid: z.number(),
    date: z.string().max(MAIL_TIME_MAX).nullable().optional(),
    from: z
        .array(z.object({ name: z.string().max(MAIL_TEXT_MAX).nullable().optional(), address: z.string().max(MAIL_TEXT_MAX).nullable().optional() }))
        .max(MAIL_LIST_MAX)
        .nullable()
        .optional(),
    subject: z.string().max(MAIL_SUBJECT_MAX).nullable().optional(),
    text: z.string().max(MAIL_BODY_MAX).nullable().optional(),
    attachments: z
        .array(
            z.object({
                name: z.string().max(MAIL_TEXT_MAX).nullable().optional(),
                type: z.string().max(MAIL_TEXT_MAX).nullable().optional(),
                size: z.number().nullable().optional(),
            }),
        )
        .max(MAIL_LIST_MAX)
        .nullable()
        .optional(),
    messageId: z.string().max(MAIL_TEXT_MAX).nullable().optional(),
    inReplyTo: z.string().max(MAIL_TEXT_MAX).nullable().optional(),
    references: z.array(z.string().max(MAIL_TEXT_MAX)).max(MAIL_LIST_MAX).nullable().optional(),
    autoSubmitted: z.string().max(MAIL_HEADER_MAX).nullable().optional(),
    precedence: z.string().max(MAIL_HEADER_MAX).nullable().optional(),
    returnPath: z.string().max(MAIL_HEADER_MAX).nullable().optional(),
})

/** The shape of the canonical event's `data`: a person's line on the mail channel with its thread keys. */
export const MAIL_RECEIVED_DATA_SCHEMA: z.ZodType<MailReceivedData> = z.object({
    messageKey: z.string().max(MAIL_TEXT_MAX + 10),
    text: z.string().max(MAIL_LINE_MAX),
    at: z.string().max(MAIL_TIME_MAX).nullable(),
    mailId: z.string().min(1).max(MAIL_TEXT_MAX),
    folder: z.string().max(MAIL_TEXT_MAX),
    subject: z.string().max(MAIL_SUBJECT_MAX),
    messageId: z.string().max(MAIL_TEXT_MAX).optional(),
    inReplyTo: z.string().max(MAIL_TEXT_MAX).optional(),
    references: z.array(z.string().max(MAIL_TEXT_MAX)).max(MAIL_LIST_MAX),
    attachments: z.array(z.string().max(MAIL_TEXT_MAX)).max(MAIL_LIST_MAX),
})
