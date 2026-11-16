import { mock } from "@starci/jest-preset"
import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { ChannelDeliveryService, CustomerSendRegistryService } from "@modules/domain/channels"
import { ChannelPlanNoticeService } from "@modules/domain/channels/channel-plan-notice.service"
import { ConnectionsService } from "@modules/domain/connections"
import { EmailMessagesService } from "@modules/domain/email-messages/email-messages.service"
import { MailCustomerSendService } from "@modules/domain/email-messages/mail-customer-send.service"
import { SmtpSandboxSendService } from "@modules/domain/email-messages/smtp-sandbox-send.service"
import { SmtpSendRegistryService } from "@modules/domain/email-messages/smtp-send-registry.service"
import { WorkspaceMailService } from "@modules/domain/email-messages/workspace-mail.service"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import type { MailRelayService } from "@modules/integrations/mail"
import type { MessageCatalog } from "@modules/platform/i18n"
import type { Logger } from "@modules/platform/logging"
import {
    ANSWER,
    FRONT,
    WS,
    drain,
    itemsOf,
    processOf,
    refOf,
    startThread,
    stopsOf,
    threadDbOf,
    type ThreadDb,
} from "./thread-world"
import { chatServicesOf } from "./thread-world-intake"
import { seededDb } from "./thread-world-process"

// The world's desk installed beside the core (as customer-send-approval.spec.ts).
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const desk: typeof import("@tests/fixtures/builders/thread-desk-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/thread-desk-plugin.builder",
    )
    return { installed: parts.installationWith([desk.DESK_PLUGIN], "world-desk") }
})

// SEND-ONE (rules SO-1..SO-3): MAIL IS A CHANNEL OF THE ONE SEND. Exposing case: a run tells a person who is known ONLY by mail. The step's
// agent makes the ONE customer send (channel `email`, a subject, the words); on an `ask` step that is ONE approval with the whole mail
// (subject and words) on its card; approved, it is delivered ONCE through the workspace's SANDBOX mail account (the real mail channel
// port, the real workspace mailer, the real SMTP sandbox twin and its cases; only the sandbox's call store is a double); a sandbox `SMTP-4`
// (the server never answers: outcome unknown) PARKS the step on the retry ladder like any channel and the timer sends it ONCE under the
// same key. Before SEND-ONE no `email` channel existed: the same call was refused (no provider served it). The second kind (a chat
// person, the same send: unchanged) is customer-send-approval.spec.ts / send-not-sent.spec.ts; a route-addressed send from a run with no
// person is route-send.spec.ts (all green with this change).

/** The workspace's sandbox mail account (provider `smtp`) the front desk is attached to. */
const MAILBOX = "smtp-1"
const ADDRESS = "lan@example.vn"
/** The inbound half's settings (MAIL-IN rule MI-1). */
const INBOUND = JSON.stringify({ folders: ["INBOX"], sinceDays: 30 })
const SUBJECT = "Gio mo cua cua shop"
const TEXT = "Shop mo cua tu 8h den 21h a."

/** A one-step flow whose agent tells the run's person, the step's mode as given. */
const flowOf = (mode: "ask" | "auto"): GraphSpec => ({
    schema: "nivo/agent-graph@1",
    moduleKey: "chatbot",
    trigger: { kind: "tag", sources: [] },
    grant: { tools: [TOOL.brainSearch], effects: [TOOL.customerMessageSend] },
    nodes: [{ key: "answer", kind: "output", step: "wdesk.answer", mode, params: { conversationId: "no-route", text: TEXT } }],
})

/** The real mail channel of the one send on a sandbox SMTP account; the sandbox's next cases are `cases` (then the default `SMTP-1`). */
const mailChannelOf = (db: ThreadDb, cases: Array<string>) => {
    // A mailbox account holding both halves (MAIL-IN rule MI-3: only such an account is an entrance).
    const account = connectionRecord({ id: MAILBOX, workspaceId: WS, provider: "smtp", sandbox: true, meta: { from_email: "shop@example.vn", config: INBOUND } })
    const sandboxCalls: Array<unknown> = []
    const sandbox = mock<ProviderSandboxService>()
    sandbox.call.mockImplementation(async (_account, _operation, request, plan) => {
        sandboxCalls.push(request)
        return plan.answer({ seq: sandboxCalls.length - 1, nextCase: cases.shift() ?? null } as Parameters<typeof plan.answer>[0])
    })
    const smtp = new SmtpSendRegistryService()
    smtp.register({ live: mock({ provider: "smtp" }), sandbox: new SmtpSandboxSendService(sandbox) })
    const connections = mock<ConnectionsService>()
    connections.find.mockResolvedValue(account)
    connections.listByProvider.mockResolvedValue([account])
    const log = mock<EmailMessagesService>()
    log.sentSince.mockResolvedValue(0)
    log.record.mockResolvedValue("e-1")
    const logger = mock<Logger>()
    const mailer = new WorkspaceMailService(mock<MailRelayService>(), db.clock, mock<MessageCatalog>(), logger, log, connections, smtp)
    const sends = new CustomerSendRegistryService()
    const port = new MailCustomerSendService(mailer)
    sends.register({ live: port, sandbox: port })
    return { sandboxCalls, delivery: new ChannelDeliveryService(mock<ChannelPlanNoticeService>(), logger, db.clock, connections, sends) }
}

/** A world whose front desk is attached to the mail account and whose person is known only by their mail address. */
const mailWorld = async (cases: Array<string>) => {
    const db = threadDbOf()
    db.rights.accounts.push({ id: MAILBOX, provider: "smtp" })
    db.rights.attachments.push({ agentId: FRONT, connectionId: MAILBOX, provider: "smtp" })
    const mail = mailChannelOf(db, cases)
    db.chat.channelDeliveries.set("email", mail.delivery)
    await seededDb(db)
    const person = (await chatServicesOf(db).contacts.meetAddress(WS, "email", ADDRESS, true)) ?? ""
    const trigger = { eventId: "tag:mail-1", contactId: person, data: { text: "Shop mo cua may gio?" }, locale: "vi" }
    return { db, mail, person, trigger }
}

const sends = { call: { tool: TOOL.customerMessageSend, args: { channel: "email", accountId: MAILBOX, subject: SUBJECT, text: TEXT } } }
const DONE = { done: { reply: TEXT } }

describe("SEND-ONE: mail is a channel of the one customer send (exposing case: a person known only by mail)", () => {
    it("`ask`: ONE approval with the whole mail on its card; approved, delivered ONCE through the SMTP sandbox on a route of the mail entrance", async () => {
        const { db, mail, trigger } = await mailWorld([])
        db.model.script(ANSWER, sends, DONE)
        const process = await processOf(db)
        const started = await startThread(process, { flow: flowOf("ask"), versionId: "chatbot-agent:mail@1", workflowId: "wf:mail", trigger })
        expect(started.error).toBeNull()
        const runId = started.runId ?? ""

        expect(itemsOf(db)).toHaveLength(1)
        const stops = await stopsOf(process, runId)
        expect(stops.map((stop) => [stop.kind, stop.state])).toEqual([["approval", "open"]])
        const card = JSON.stringify(stops[0]?.detail.approvalCard)
        expect(card).toContain(SUBJECT)
        expect(card).toContain(TEXT)
        expect(mail.sandboxCalls).toEqual([])

        const from = db.wakes.length
        const workItemId = itemsOf(db)[0]?.item.id ?? ""
        await process.approvals?.decided(
            { workspaceId: WS, runId, stepKey: "answer", workItemId, verdict: "approved", by: "owner-1", text: "" },
            process.requests,
        )
        db.model.script(ANSWER, sends, DONE)
        await drain(process, from)

        expect(mail.sandboxCalls).toEqual([expect.objectContaining({ to: ADDRESS, subject: SUBJECT })])
        expect(db.chat.ledger.rows.map((row) => [row.channel, row.accountId, row.state, row.text])).toEqual([["email", MAILBOX, "delivered", TEXT]])
        expect((await process.threads.stateOf(refOf(runId)))?.status).toBe("ended")
    })

    it("`auto`: the sandbox's SMTP-4 (no answer: outcome unknown) parks the step on the retry ladder; the timer sends it ONCE, same key", async () => {
        const { db, mail, trigger } = await mailWorld(["SMTP-4"])
        db.model.script(ANSWER, sends, sends, DONE)
        const process = await processOf(db)
        const started = await startThread(process, { flow: flowOf("auto"), versionId: "chatbot-agent:mail@1", workflowId: "wf:mail", trigger })
        const runId = started.runId ?? ""

        expect(await stopsOf(process, runId)).toEqual([])
        const view = await process.threads.stateOf({ workspaceId: WS, runId })
        const park: unknown = view?.status === "stopped" ? view.stop?.question : null
        expect(park).toMatchObject({ kind: "until_round", loopKey: "retry:answer", round: 1 })
        expect(db.chat.ledger.rows.map((row) => [row.channel, row.state])).toEqual([["email", "unknown"]])
        expect(mail.sandboxCalls).toHaveLength(1)

        db.clock.advance(2 * 60_000)
        const from = db.wakes.length
        const parkKey = typeof park === "object" && park !== null ? String(Reflect.get(park, "parkKey")) : ""
        await expect(process.deadlines?.fire({ workspaceId: WS, runId, stepKey: parkKey, repeats: 1, answered: -1 })).resolves.toBe("admitted")
        await drain(process, from)

        expect(await stopsOf(process, runId)).toEqual([])
        expect(db.chat.ledger.rows.map((row) => [row.channel, row.state, row.text])).toEqual([["email", "delivered", TEXT]])
        expect(mail.sandboxCalls).toHaveLength(2)
        expect(db.lines.map((line) => line.text)).toEqual([TEXT])
    })
})
