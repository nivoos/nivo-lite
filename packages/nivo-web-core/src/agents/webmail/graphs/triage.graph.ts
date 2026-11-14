import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import {
    type TemplateCatalogue,
    type TemplateGraph,
    callWorkflow,
    defineTemplateGraph,
    equals,
    ifNode,
    node,
    outcome,
    ref,
    trigger,
} from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { webmailHearNode } from "../nodes/hear.node"
import { webmailSortNode } from "../nodes/sort.node"
import { webmailSortedReportNode } from "../nodes/sorted-report.node"

/** The key of the Mailbox agent's front door. */
export const WEBMAIL_TRIAGE_KEY = "webmail.triage"

/**
 * The graph's contract: the GENERIC trigger scope of a person's mail on the one event pipeline (the same as a chat message's): the route,
 * the contact and the mailbox account the engine met the person on, the person on the mail channel (their address) and the event's data (one
 * line: its words, the mail's own id and subject; the other mails of a burst are the route's unread lines).
 */
const triageInput = z.object({
    eventId: z.string().min(1).max(200),
    routeId: z.string().min(1).max(200),
    contactId: z.string().max(200).nullish(),
    accountId: z.string().min(1).max(200),
    subject: z.object({ channel: z.string().min(1).max(200), id: z.string().max(400), name: z.string().max(400).nullish() }),
    data: z.object({
        messageKey: z.string().max(400).nullish(),
        text: z.string().max(20_000),
        at: z.string().max(200).nullish(),
        mailId: z.string().min(1).max(200),
        subject: z.string().max(400),
        attachments: z.array(z.string().max(400)).max(100).nullish(),
    }),
})

/** What the template catalogue shows of version 9: the texts of version 8; the trigger is listed on the `smtp` mailbox account (its kind) instead of `imap`. */
const CATALOGUE: TemplateCatalogue = {
    name: { vi: "Đọc thư mới", en: "Read new mail" },
    summary: {
        vi: "Khi một người gửi thư tới hộp thư được gắn, phân loại thư và chuyển cho agent lo việc đó (gia hạn, hỗ trợ, hoá đơn nhà cung cấp, hỏi mua); thư cần người xử lý thì báo đội trong /chat",
        en: "When a person mails an attached mailbox, sorts the mail and passes it to the agent that handles it (renewal, support, supplier invoice, enquiry); a mail that needs a person is told to the team in /chat",
    },
    version: 9,
    publishedAt: "2026-11-15T00:10:00.000Z",
    notes: {
        vi: "Thư của một người là một dòng của họ trên cuộc trò chuyện với hộp thư (như tin nhắn ở kênh chat): quy trình chạy mỗi khi có thư của một người, nghe các thư chưa xử lý của người đó như một thư thay vì liệt kê hộp thư mỗi 15 phút; mỗi thư chuyển cho đúng một agent và kết thúc lượt (như lễ tân ở kênh chat); hộp thư là một tài khoản (smtp, có phần nhận); thư chuyển đi kèm cuộc trò chuyện để trả lời đúng người đó",
        en: "A person's mail is their line on their conversation with the mailbox (like a message on a chat channel): the workflow runs when a person mails, hears that person's unhandled mails as one mail instead of listing the mailbox every 15 minutes; each mail goes to exactly one agent and the run ends there (as a chat front desk does); a mailbox is one account (smtp, with its inbound half); the hand-off carries the conversation so the reply goes back to that person",
    },
}

/**
 * `webmail.triage` version 8 ("Read new mail", the Mailbox's front door): a person's mail to an attached mailbox wakes it, exactly as a
 * customer's message wakes a chat graph (the one event pipeline: the person on the mail channel, their route on the mailbox account, one
 * run per person, the mails they send while it runs held behind it). `hear` takes the person's unhandled mails as ONE mail (their lines of
 * the route after the stream cursor; no mailbox is listed); `sort` reads what it is (the model's judgement) and ROUTES it: a renewal reply
 * -> Renewals, a support request -> Support, a supplier invoice -> Accounting, an enquiry -> Sales (each hand-off carries the person's route,
 * so a reply goes back on it through the one send, and ENDS the run: later mails of the person go on from the callee); a mail that needs a
 * person is told to the team in /chat (`report`; a declined post ends `declined`); a mail nobody needs to act on ends `nothing`. Not merged
 * with the chat front doors: they answer a person in their conversation, this sorts four kinds of mail (supplier invoices among them) and
 * tells the team what needs a person. Change from version 7: the clock round, the batch read, the loop and the four lists are gone (the
 * engine's rule: a person's run hands on once and ends); the contract is the channel message's generic scope; the mailbox is the agent's
 * `smtp` account.
 */
export const webmailTriageGraph: TemplateGraph = defineTemplateGraph({
    key: WEBMAIL_TRIAGE_KEY,
    title: CATALOGUE.name,
    catalogue: CATALOGUE,
    input: triageInput,
    triggers: [
        // Every attached mailbox is a source (cto@, ketoan@, support@: three streams). The trigger belongs to the provider kind of the account that
        // receives it: a mailbox is ONE `smtp` account with an inbound half (read by the `imap` receiver), so the trigger is `smtp:mail.received`;
        // an `imap` account standing alone is no customer entrance.
        trigger(TRIGGER.mailMessageReceived, { accounts: [PROVIDER.smtp] }),
    ],
    openTo: "agent",
    start: "hear",
    nodes: {
        // The first step: the person's unhandled mails as one mail (the engine kept each line at delivery); it reads no mailbox.
        hear: node(webmailHearNode, {
            input: {
                accountId: ref("trigger.accountId"),
                subject: ref("trigger.subject"),
                data: ref("trigger.data"),
            },
            next: "sort",
        }),
        sort: node(webmailSortNode, {
            input: {
                id: ref("steps.hear.output.mail.id"),
                mailbox: ref("steps.hear.output.mail.mailbox"),
                from: ref("steps.hear.output.mail.from"),
                subject: ref("steps.hear.output.mail.subject"),
                text: ref("steps.hear.output.mail.text"),
                hasAttachments: ref("steps.hear.output.mail.hasAttachments"),
                locale: "vi",
            },
            routes: {
                "renewal-reply": "to-renewals",
                ticket: "to-tickets",
                "supplier-invoice": "to-invoices",
                enquiry: "to-enquiries",
                "needs-person": "report",
                other: "nothing",
            },
        }),
        "to-renewals": callWorkflow({
            agent: "webrenew",
            workflow: "mail-replies",
            version: "latest",
            input: { mails: ref("steps.sort.output.handed") },
        }),
        "to-tickets": callWorkflow({
            agent: "webdesk",
            workflow: "mail-tickets",
            version: "latest",
            input: { mails: ref("steps.sort.output.handed"), routeId: ref("trigger.routeId") },
        }),
        "to-invoices": callWorkflow({
            agent: "webbooks",
            workflow: "supplier-invoices",
            version: "latest",
            input: { mails: ref("steps.sort.output.handed") },
        }),
        "to-enquiries": callWorkflow({
            agent: "websales",
            workflow: "mail-enquiries",
            version: "latest",
            input: { mails: ref("steps.sort.output.handed"), routeId: ref("trigger.routeId") },
        }),
        report: node(webmailSortedReportNode, {
            input: {
                mailId: ref("steps.sort.output.mailId"),
                mailbox: ref("steps.sort.output.mailbox"),
                from: ref("steps.sort.output.from"),
                subject: ref("steps.sort.output.subject"),
                summary: ref("steps.sort.output.summary"),
                locale: "vi",
            },
            next: "report-declined",
        }),
        "report-declined": ifNode({
            label: { vi: "Bị từ chối báo đội?", en: "Team report declined?" },
            when: equals(ref("steps.report.output.declined"), true),
            yes: "declined",
            no: "told",
        }),
        told: outcome({ name: "told", label: { vi: "Đã báo đội", en: "Team told" } }),
        nothing: outcome({ name: "nothing", label: { vi: "Không cần xử lý", en: "Nothing to act on" } }),
        declined: outcome({ name: "declined", label: { vi: "Bị từ chối", en: "Declined" } }),
    },
})
