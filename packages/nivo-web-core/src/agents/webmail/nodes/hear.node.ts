import { TOOL } from "@nivo-lite/agent-sdk/names"
import { type TemplateNode, defineTemplateNode } from "@nivo-lite/agent-sdk/template"
import { threadRowsOf, unreadLinesOf } from "@nivo-lite/blocks-core"
import { z } from "zod"
import { webmailText } from "../copy"
import { answered } from "../../../shared/nodes/web-answers"
import { HEARD_TEXT_MAX, type HeardMail, ROUND_MAILS_MAX, heardMailSchema } from "./mail-shapes"

/**
 * What a person's mail wakes the run with: the generic members of a channel message on the one event pipeline (the mailbox account the
 * engine met the person on, the person on the mail channel, the event's data: the mail's own head and the line's words). The other mails
 * the person sent while the run was busy are the route's lines the stream cursor has not consumed: this step reads them itself.
 */
export interface HearInput {
    /** The mailbox account (connection id) the person mailed. */
    readonly accountId: string
    /** The person on the mail channel: their address. */
    readonly subject: { readonly channel: string; readonly id: string; readonly name?: string | null | undefined }
    /** The event's data: the mail that woke the run. */
    readonly data: {
        /** The mail's id in the mailbox. */
        readonly mailId: string
        /** The subject line, as written. */
        readonly subject: string
        /** The line's words: the subject line, then the text. */
        readonly text: string
        /** The names of the files that came with it. */
        readonly attachments?: ReadonlyArray<string> | null | undefined
    }
}

/** What the person mailed that no run consumed yet, as ONE mail (a burst of mails is one message to read, as a burst of chat lines is). */
export interface HearOutput {
    /** The mail: the woken mail's id, subject and files, and the words of every unconsumed line, oldest first. */
    readonly mail: HeardMail
}

type NoParams = Record<string, never>

const params: z.ZodType<NoParams> = z.strictObject({})
const input: z.ZodType<HearInput> = z.object({
    accountId: z.string().min(1).max(100),
    subject: z.object({
        channel: z.string().min(1).max(100),
        id: z.string().max(400),
        name: z.string().max(400).nullish(),
    }),
    data: z.object({
        mailId: z.string().min(1).max(100),
        subject: z.string().max(400),
        text: z.string().max(HEARD_TEXT_MAX),
        attachments: z.array(z.string().max(400)).max(100).nullish(),
    }),
})
const output: z.ZodType<HearOutput> = z.object({ mail: heardMailSchema })

/** Between the words of two mails of one burst. */
const BETWEEN_MAILS = "\n\n"

const MAILBOX = "7d1c2f4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
const STAMP = "2026-11-14T02:00:00.000Z"
const FIRST_WORDS = "Website loi 500\n\nWebsite cua shop bao loi 500 tu sang nay"
const SECOND_WORDS = "Them thong tin: loi bat dau luc 7h"

const EVENT: HearInput = {
    accountId: MAILBOX,
    subject: { channel: "email", id: "hoamai@example.com", name: "Shop Hoa Mai" },
    data: { mailId: "INBOX:1:41", subject: "Website loi 500", text: FIRST_WORDS, attachments: [] },
}

const FIRST: HeardMail = {
    id: "INBOX:1:41",
    mailbox: MAILBOX,
    from: "hoamai@example.com",
    subject: "Website loi 500",
    text: FIRST_WORDS,
    hasAttachments: false,
}

/** The conversation read of an example: the lines newest first, as the engine answers them (the stream cursor named when a run consumed some). */
const threadOf = (facts: ReadonlyArray<Record<string, string>>, consumedSeq: string | null = null) => ({
    id: TOOL.conversationMessageList,
    answer: answered({ notice: "", source: "nivo.conversation", asOf: STAMP, consumedSeq, facts: [...facts] }),
})

/**
 * `webmail.hear` (Hear the new mail): the first step of the Mailbox's front door, plain code, no AI. A person's mail is their line on their
 * route (the engine kept it at delivery, subject then words), so nothing is listed from the mailbox: the step hears the person's lines
 * of the route after the position a run consumed (the engine's stream cursor, read with `consume`), oldest first, as ONE mail (the way
 * a chat graph hears a burst of lines as one message): the woken mail's id and subject, the words of every unconsumed line. The woken
 * mail stands alone when the route shows nothing unread. It reads no mailbox and writes nothing.
 */
export const webmailHearNode: TemplateNode<z.ZodType<HearInput>, z.ZodType<HearOutput>, z.ZodType<NoParams>> =
    defineTemplateNode({
        id: "webmail.hear",
        title: webmailText("node.hear.title"),
        description: {
            vi: "Nghe những thư người gửi chưa được xử lý trong cuộc trò chuyện của họ với hộp thư, gộp thành một thư.",
            en: "Hears the mails the person sent that no run handled yet, from their conversation with the mailbox, as one mail.",
        },
        tools: [TOOL.conversationMessageList],
        mode: "auto",
        accounts: [],
        params,
        input,
        output,
        sensitive: { mail: "pii" },
        run: async (given, context) => {
            const unread = unreadLinesOf(await threadRowsOf(context, { consume: true }))
            const words =
                unread.length === 0
                    ? given.data.text
                    : unread
                          .slice(-ROUND_MAILS_MAX)
                          .map((line) => line.text)
                          .join(BETWEEN_MAILS)
            return {
                mail: {
                    id: given.data.mailId,
                    mailbox: given.accountId,
                    from: given.subject.id,
                    subject: given.data.subject,
                    text: words.slice(0, HEARD_TEXT_MAX),
                    hasAttachments: (given.data.attachments ?? []).length > 0,
                },
            }
        },
        examples: [
            {
                name: "a person's mail: the one line no run consumed is heard, with the mail's own id and subject",
                params: {},
                input: EVENT,
                tools: [threadOf([{ seq: "7", role: "user", text: FIRST_WORDS, at: STAMP }])],
                output: { mail: FIRST },
            },
            {
                name: "a second mail came while the run was busy: both are heard together as one mail, oldest first",
                params: {},
                input: EVENT,
                tools: [
                    threadOf(
                        [
                            { seq: "8", role: "user", text: SECOND_WORDS, at: "2026-11-14T02:01:00.000Z" },
                            { seq: "7", role: "user", text: FIRST_WORDS, at: STAMP },
                            { seq: "6", role: "agent", text: "Da nhan", at: "2026-11-14T01:00:00.000Z" },
                        ],
                        "6",
                    ),
                ],
                output: { mail: { ...FIRST, text: `${FIRST_WORDS}${BETWEEN_MAILS}${SECOND_WORDS}` } },
            },
            {
                name: "the route shows nothing unread (a run consumed it): the mail that woke the run stands alone",
                params: {},
                input: EVENT,
                tools: [threadOf([{ seq: "9", role: "agent", text: "Da nhan", at: "2026-11-14T03:00:00.000Z" }])],
                output: { mail: FIRST },
            },
        ],
    })
