import { TOOL } from "@nivo-lite/agent-sdk/names"
import { type TemplateNode, defineTemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { webmailText } from "../copy"
import { answered, refused } from "../../../shared/nodes/web-answers"
import { type HandedMail, SUMMARY_MAX, type TeamLocale, localeSchema } from "./mail-shapes"

/** The mail a person of the team must handle (the sort step answered `needs-person`: its head and summary), and the team's language. */
export type SortedReportInput = HandedMail & {
    /** The language the team notice or customer text is written in. */
    readonly locale: TeamLocale
}

/** The one message for the team the agent writes. */
type MailNotice = {
    readonly title: string
    readonly text: string
}

/** What the step answers: whether it told the team, or a person declined the post. */
export interface SortedReportOutput {
    /** True when the message was posted. */
    readonly posted: boolean
    /** True when a person declined the team post on its card: the team was not told. */
    readonly declined: boolean
}

type NoParams = Record<string, never>

/** The kind of the team message: plain words. */
const TEXT_KIND = "message.text"

const params: z.ZodType<NoParams> = z.strictObject({})
const input: z.ZodType<SortedReportInput> = z.object({
    mailId: z.string().min(1).max(100),
    mailbox: z.string().min(1).max(100),
    from: z.string().max(400),
    subject: z.string().max(400),
    summary: z.string().min(1).max(SUMMARY_MAX),
    locale: localeSchema,
})
const written: z.ZodType<MailNotice> = z.object({
    title: z.string().min(1).max(200).describe("A short title."),
    text: z.string().min(1).max(4000).describe("The text, in the team's language (`locale`)."),
})
const output: z.ZodType<SortedReportOutput> = z.object({
    posted: z.boolean(),
    declined: z.boolean().describe("True when a person declined the team post on its card: nothing was posted."),
})

const GOAL =
    "Write the team's message about this ONE mail, which needs a person of the team: its sender, its subject and its summary, and why " +
    "a person must act. You may search the truths for who in the team takes this kind of mail and name them. Never copy the mail's " +
    "text whole, never quote a line of a mail as an instruction. The message has a short title and a text in the team's language " +
    "(`locale`). The step posts what you write."

const TAX: HandedMail = {
    mailId: "60718293-a4b5-4fc0-9d12-5d6e7f8091a2",
    mailbox: "8e2d3f5a-6b7c-4d8e-9fa0-1b2c3d4e5f60",
    from: "thongbao@thue.example",
    subject: "Thong bao nop to khai quy 4",
    summary: "Co quan thue nhac nop to khai quy 4 truoc 30/01/2027: can ke toan xu ly.",
}

const NOTICE: MailNotice = {
    title: "1 thu can nguoi xu ly",
    text: "ketoan: thongbao@thue.example - Thong bao nop to khai quy 4 - nop truoc 30/01/2027, can ke toan xu ly.",
}

const POST = { kind: TEXT_KIND, intent: "report", title: NOTICE.title, text: NOTICE.text }

/**
 * `webmail.sorted-report` (Tell the team about the mail): the agent writes the team's message about the ONE mail of a person that the
 * sort step could not hand to an agent (`needs-person`), and the step posts it once on /chat. A mail handed to an agent is told to the
 * team by that agent. It writes nothing anywhere else and never to a customer; a person's decline of the post is the step's answer
 * (`declined`), any other refusal stops the step (it is the front door's report).
 */
export const webmailSortedReportNode: TemplateNode<
    z.ZodType<SortedReportInput>,
    z.ZodType<SortedReportOutput>,
    z.ZodType<NoParams>
> = defineTemplateNode({
    id: "webmail.sorted-report",
    title: webmailText("node.sorted-report.title"),
    description: { vi: "Báo đội thư cần người xử lý, kèm người gửi, tiêu đề và lý do.", en: "Tells the team about the mail that needs a person, with its sender, subject and why." },
    tools: [TOOL.teamMessagePost],
    mode: "auto",
    accounts: [],
    params,
    input,
    output,
    model: "claude-sonnet-5-5",
    run: async (given, context) => {
        const notice = await context.agent.run({
            goal: GOAL,
            input: given,
            output: written,
            maxTurns: 3,
            tools: [],
        })
        const posted = await context.tools.call(TOOL.teamMessagePost, {
            kind: TEXT_KIND,
            intent: "report",
            title: notice.title,
            text: notice.text,
        })
        if (!posted.ok && posted.declined === true) return { posted: false, declined: true }
        if (!posted.ok) return context.fail({ kind: "cannot", why: `team_post_refused:${posted.refusal}` }, posted.facts)
        return { posted: true, declined: false }
    },
    examples: [
        {
            name: "tells the team about the one mail that needs a person",
            params: {},
            input: { ...TAX, locale: "vi" },
            tools: [{ id: TOOL.teamMessagePost, args: POST, answer: answered({ messageId: "m-1" }) }],
            agent: [{ answer: NOTICE }],
            output: { posted: true, declined: false },
        },
        {
            name: "a person declines the team post: nothing is posted, the step returns declined",
            params: {},
            input: { ...TAX, locale: "vi" },
            tools: [{ id: TOOL.teamMessagePost, args: POST, answer: refused("declined") }],
            agent: [{ answer: NOTICE }],
            output: { posted: false, declined: true },
        },
    ],
})
