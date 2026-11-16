import { mock } from "@starci/jest-preset"
import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { AccountDataAdmissionsService, type AccountDataIntakeService } from "@modules/domain/account-data"
import { ChannelDeliveryService, CustomerSendRegistryService } from "@modules/domain/channels"
import { ChannelPlanNoticeService } from "@modules/domain/channels/channel-plan-notice.service"
import type { ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import { IMAP_MAIL_TRIGGER } from "@modules/domain/data-hub/imap-mail.trigger"
import { ImapSandboxPollerService } from "@modules/domain/data-hub/imap-sandbox-poller.service"
import { MailAdmissionService } from "@modules/domain/data-hub/mail-admission.service"
import { PollReceiptsService } from "@modules/domain/connection-poll/poll-receipts.service"
import { IMAP_MAIL_TYPE } from "@modules/domain/data-records"
import { EmailMessagesService } from "@modules/domain/email-messages/email-messages.service"
import { MailCustomerSendService } from "@modules/domain/email-messages/mail-customer-send.service"
import { SmtpSandboxSendService } from "@modules/domain/email-messages/smtp-sandbox-send.service"
import { SmtpSendRegistryService } from "@modules/domain/email-messages/smtp-send-registry.service"
import { WorkspaceMailService } from "@modules/domain/email-messages/workspace-mail.service"
import type { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import { triggerDeclarations } from "@modules/domain/provider-triggers"
import type { MailRelayService } from "@modules/integrations/mail"
import type { MessageCatalog } from "@modules/platform/i18n"
import type { Logger } from "@modules/platform/logging"
import { ANSWER, CONTACT, FRONT, UNDERSTAND, WS, processOf, runHeard, startThread, threadDbOf, type ThreadDb } from "./thread-world"
import { chatServicesOf, transactionalManager, type HeardWake } from "./thread-world-intake"
import { seededDb } from "./thread-world-process"

// The world's desk installed beside the core (as mail-send.spec.ts): its front desk takes a person's mail as it takes a chat line.
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const desk: typeof import("@tests/fixtures/builders/thread-desk-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/thread-desk-plugin.builder",
    )
    return { installed: parts.installationWith([desk.DESK_PLUGIN], "world-desk") }
})

// MAIL-IN (rules MI-1, MI-3, MI-4, MI-5). Exposing case: ONE mailbox account (provider `smtp` holding its inbound `imap` half) receives a
// sandbox mail (`IMAP-1`) through the REAL poll receiver (the sandbox twin) and the REAL generic store + mail admission (the one intake's insert-or-nothing, then
// the mailbox's trigger in the same transaction): ONE wake (combine `stream`), ONE stored line of the person (the subject and the words) on
// their route of the mailbox, the person met by their ADDRESS; the workflow answers by mail on that route ONCE, threaded under the person's
// mails (In-Reply-To / References recorded by the SMTP sandbox); a second mail of the thread (`IMAP-9`) while the run is still going is HELD
// behind it and starts ONE next run on the same route; every answer is threaded under the person's mails on the route. Before MAIL-IN the same mail woke a run
// with no person and no route (`key: none`), so no answer could go on its thread. Real: the poll receiver, the generic poll store, the mail admission, the translate,
// `deliver` (enrich by address, match, correlate, combine), the contacts, routes and lines, the flow, the send, the mail port, the workspace
// mailer, the SMTP sandbox. Doubles: the sandbox's state store, the intake's table (memory, insert-or-nothing on the key), the model.

/** The mailbox account: one address, both halves. */
const MAILBOX = "smtp-mailbox-1"
const INBOUND = JSON.stringify({ folders: ["INBOX"], sinceDays: 30 })
const MAILBOX_META = { from_email: "shop@example.com", email: "shop@example.com", config: INBOUND }
/** The sender of the sandbox sets IMAP-1 / IMAP-8 / IMAP-9. */
const SENDER = "an.nguyen@example.com"
const REPLY_SUBJECT = "Re: Website bi loi khi thanh toan"

/** The sandbox's state of every account (its next case of an operation, its kept state), as the frame keeps it: memory. */
const sandboxOf = () => {
    const state = new Map<string, unknown>()
    const calls: Array<{ readonly operation: string; readonly request: unknown }> = []
    let next: string | null = null
    const sandbox = mock<ProviderSandboxService>()
    sandbox.call.mockImplementation(async (account, operation, request, plan) => {
        calls.push({ operation, request })
        const seq = calls.filter((one) => one.operation === operation).length - 1
        const picked = operation === "pull" ? next : null
        return plan.answer({
            seq,
            nextCase: picked,
            read: (name: string, key: string) => Promise.resolve(state.get(`${account.id}:${name}:${key}`) ?? null),
            write: (name: string, key: string, value: unknown) => {
                state.set(`${account.id}:${name}:${key}`, value)
                return Promise.resolve()
            },
        } as Parameters<typeof plan.answer>[0])
    })
    return { sandbox, calls, pick: (caseId: string): void => void (next = caseId) }
}

/** The one intake over the world's raw rows: insert-or-nothing on (type, account, key), pending until completed. */
const intakeOf = (db: ThreadDb, account: ConnectionRecord): AccountDataIntakeService => {
    const pending = new Set<string>()
    return mock<AccountDataIntakeService>({
        write: (_tx, connectionId, inputs) => {
            const rows = inputs.map((input) => {
                const key = String(Reflect.get(input.value, "externalId"))
                const kept = db.chat.raw.find((one) => one.connectionId === connectionId && one.type === input.type && one.key === key)
                if (kept !== undefined) return { type: input.type, key, id: "", isNew: false }
                const id = `row-${db.chat.raw.length + 1}`
                db.chat.raw.push({ id, connectionId, type: input.type, key, value: { ...input.value }, occurredAt: db.clock.now() })
                pending.add(id)
                return { type: input.type, key, id, isNew: true }
            })
            return Promise.resolve({ owner: { provider: account.provider, connectionId, workspaceId: WS }, rows })
        },
        lockPending: (_tx, type, connectionId, key) => {
            const row = db.chat.raw.find((one) => one.connectionId === connectionId && one.type === type && one.key === key)
            return Promise.resolve(row === undefined || !pending.has(row.id) ? null : { id: row.id, type, key, owner: { provider: account.provider, connectionId, workspaceId: WS }, value: row.value })
        },
        complete: (_tx, row) => {
            pending.delete(row.id)
            return Promise.resolve()
        },
    })
}

/** The mail channel of the one send on the mailbox (real port, real mailer, real SMTP sandbox; its call store is the sandbox's). */
const mailChannelOf = (db: ThreadDb, account: ConnectionRecord, sandbox: ProviderSandboxService) => {
    const smtp = new SmtpSendRegistryService()
    const twin = new SmtpSandboxSendService(sandbox)
    smtp.register({ live: twin, sandbox: twin })
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
    return new ChannelDeliveryService(mock<ChannelPlanNoticeService>(), logger, db.clock, connections, sends)
}

/** A world whose front desk is attached to ONE mailbox account (both halves, unless `meta` says otherwise). */
const mailboxWorld = async (meta: Readonly<Record<string, string>> = MAILBOX_META, provider: "smtp" | "imap" = "smtp") => {
    const db = threadDbOf()
    const account = connectionRecord({ id: MAILBOX, workspaceId: WS, provider, sandbox: true, meta })
    db.rights.accounts.push({ id: MAILBOX, provider, meta })
    db.rights.attachments.push({ agentId: FRONT, connectionId: MAILBOX, provider })
    triggerDeclarations.register(IMAP_MAIL_TRIGGER)
    const box = sandboxOf()
    db.chat.channelDeliveries.set("email", mailChannelOf(db, account, box.sandbox))
    await seededDb(db)
    // The one poll job's road: the sandbox receiver reads the page, the generic store keeps its rows through the one intake and hands each
    // new one to the `imap.mail` admission (the mail admission: the mailbox's trigger and the completion, in the same transaction).
    const face = new ImapSandboxPollerService(box.sandbox, db.clock)
    const logger = mock<Logger>()
    const intake = intakeOf(db, account)
    const admissions = new AccountDataAdmissionsService()
    const mail = new MailAdmissionService(logger, intake, chatServicesOf(db).triggers)
    admissions.register(IMAP_MAIL_TYPE, (tx, row) => mail.admit(tx, row))
    const receipts = new PollReceiptsService(transactionalManager(), intake, admissions)
    /** The connection poll's walk of the mailbox after the sandbox picked `caseId`: one page, its rows kept through the generic store. */
    const polled = async (caseId: string): Promise<ReadonlyArray<HeardWake>> => {
        box.pick(caseId)
        const before = db.chat.wakes.length
        const page = await face.read(account, { from: new Date(0), to: undefined, limit: 50 })
        if (page.kind === "page") await receipts.keep(account, IMAP_MAIL_TYPE, page.items)
        return db.chat.wakes.slice(before)
    }
    const mailsSent = () => box.calls.filter((one) => one.operation === "send").map((one) => one.request as Record<string, unknown>)
    return { db, account, polled, mailsSent, logger, intake }
}

/** The route of the person's mails on the mailbox. */
const mailRouteOf = (db: ThreadDb): string => db.chat.lines.heard.find((line) => line.key.startsWith("email:"))?.routeId ?? ""

/** The model's send of the answer: on the woken route, with the subject the mail channel requires. */
const sendsOn = (routeId: () => string, text: string) => ({
    call: { tool: TOOL.customerMessageSend, args: { get conversationId() { return routeId() }, subject: REPLY_SUBJECT, text } },
})

describe("MAIL-IN: a person's mail is a line on their route of the ONE mailbox account (exposing case)", () => {
    it("ONE wake and ONE stored line per mail; the answer goes by mail ONCE, threaded; a second mail of the thread is held and runs next", async () => {
        const { db, polled, mailsSent } = await mailboxWorld()
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "An: loi thanh toan" } }, { done: { branch: "question", summary: "An: van loi" } })
        db.model.script(
            ANSWER,
            sendsOn(() => mailRouteOf(db), "Shop dang kiem tra loi thanh toan a."),
            { done: { reply: "Shop dang kiem tra loi thanh toan a." } },
            sendsOn(() => mailRouteOf(db), "Shop da sua buoc chon phuong thuc thanh toan a."),
            { done: { reply: "Shop da sua buoc chon phuong thuc thanh toan a." } },
        )
        const process = await processOf(db)
        const paused = db.model.hold(UNDERSTAND)

        const first = await polled("IMAP-1")
        // ONE wake of the mail verb, combined as a stream, on the person's route; ONE line with the subject and the words.
        expect(first).toHaveLength(1)
        expect(first[0]?.context).toMatchObject({ verb: TRIGGER_MAIL, combine: "stream", connectionId: MAILBOX })
        const routeId = mailRouteOf(db)
        expect(first[0]?.context).toMatchObject({ conversationId: routeId })
        expect(db.chat.lines.heard.map((line) => [line.key, line.text])).toEqual([
            ["email:<sbx-imap-1@sandbox.nivo>", expect.stringMatching(/^Website bi loi khi thanh toan\n\nChao shop/u)],
        ])
        // The person is met by their ADDRESS (a person-level identity), never as one account's own id.
        const person = (await chatServicesOf(db).contacts.meetAddress(WS, "email", SENDER, false)) ?? ""
        expect(first[0]?.context).toMatchObject({ contactId: person })
        // The same mail polled again is nothing (the intake's key IS the reconciliation).
        expect(await polled("IMAP-1")).toEqual([])
        expect(db.chat.raw.filter((row) => row.type === "imap.mail")).toHaveLength(1)

        const running = runHeard(process, first)
        await paused.entered
        const second = await polled("IMAP-9")
        expect(second).toHaveLength(1)
        const held = await runHeard(process, second)
        expect(held.ending?.status).toBe("held")
        paused.release()
        expect((await running).error).toBeNull()

        // The first answer: ONE mail on the route, threaded under the person's mails as the route holds them when it goes (the second mail
        // arrived while the run was going: the newest one is the one answered, the thread holds both).
        const thread = { inReplyTo: "<sbx-imap-2@sandbox.nivo>", references: ["<sbx-imap-1@sandbox.nivo>", "<sbx-imap-2@sandbox.nivo>"] }
        expect(mailsSent()).toEqual([expect.objectContaining({ to: SENDER, subject: REPLY_SUBJECT, ...thread })])
        const next = await runHeard(process, second)
        expect(next.error).toBeNull()
        // The held mail ran next, on the SAME route; its answer is threaded under both of the person's mails.
        expect(db.chat.lines.heard.map((line) => line.routeId)).toEqual([routeId, routeId])
        expect(mailsSent()).toHaveLength(2)
        expect(mailsSent()[1]).toMatchObject({ to: SENDER, ...thread })
        expect(db.chat.ledger.rows.map((row) => [row.channel, row.accountId, row.routeId, row.state])).toEqual([
            ["email", MAILBOX, routeId, "delivered"],
            ["email", MAILBOX, routeId, "delivered"],
        ])
    })
})

describe("MAIL-IN: a trigger belongs to the provider KIND of the account that receives it (the mailbox is ONE account of kind `smtp`)", () => {
    it("a new mail polled on a mailbox smtp account holding the inbound half: admission, then `deliver` with the declaration on smtp opens the gate (the account acts as smtp), the graph listing accounts [smtp] is matched: ONE wake", async () => {
        const { db, polled, intake, account } = await mailboxWorld()
        expect(IMAP_MAIL_TRIGGER.provider).toBe("smtp")
        expect(account.provider).toBe("smtp")
        expect(db.rights.accounts.find((one) => one.id === MAILBOX)?.provider).toBe("smtp")

        const wakes = await polled("IMAP-1")

        expect(wakes).toHaveLength(1)
        expect(wakes[0]?.context).toMatchObject({ verb: TRIGGER_MAIL, connectionId: MAILBOX })
        expect(wakes[0]?.agentId).toBe(FRONT)
        // The row was kept as the mailbox's data and completed by the admission in the same walk.
        expect(db.chat.raw.filter((row) => row.type === "imap.mail" && row.connectionId === MAILBOX)).toHaveLength(1)
        await expect(intake.lockPending({} as never, "imap.mail", MAILBOX, "INBOX:1:1")).resolves.toBeNull()
    })

    it("an `imap` account standing alone is no entrance: its mail row is kept and completed, `deliver` answers `disconnected`, no wake, no line", async () => {
        const { db, polled, intake } = await mailboxWorld({ config: INBOUND }, "imap")
        const delivered = jest.spyOn(chatServicesOf(db).triggers, "deliver")

        const wakes = await polled("IMAP-1")

        expect(delivered).toHaveBeenCalledTimes(1)
        await expect(delivered.mock.results[0]?.value).resolves.toEqual({ status: "disconnected" })
        expect(wakes).toEqual([])
        expect(db.chat.lines.heard).toEqual([])
        expect(db.chat.raw.filter((row) => row.type === "imap.mail" && row.connectionId === MAILBOX)).toHaveLength(1)
        await expect(intake.lockPending({} as never, "imap.mail", MAILBOX, "INBOX:1:1")).resolves.toBeNull()
    })
})

describe("MAIL-IN: second kind (a mail no person wrote; a known chat customer's mail; a mailbox with one half)", () => {
    it("an auto-reply (Auto-Submitted) is kept as the account's data and is no line: no wake, no route, counted", async () => {
        const { db, polled, logger } = await mailboxWorld()

        expect(await polled("IMAP-8")).toEqual([])

        expect(db.chat.raw.filter((row) => row.type === "imap.mail")).toHaveLength(1)
        expect(db.chat.lines.heard).toEqual([])
        expect(logger.info).toHaveBeenCalledWith("data_hub.mail_not_from_person", expect.objectContaining({ connectionId: MAILBOX, notFromPerson: 1 }))
    })

    it("a mail from the address a chat customer gave joins THAT contact, with a second route (the mailbox's)", async () => {
        const { db, polled } = await mailboxWorld()
        // The seeded Zalo customer gave their mail address in the chat (a claim kept on their contact).
        await chatServicesOf(db).contacts.linkIdentity(WS, CONTACT, { kind: "email", value: SENDER }, { kind: "channel" })

        const wakes = await polled("IMAP-1")

        expect(wakes[0]?.context).toMatchObject({ contactId: CONTACT })
        const routes = await chatServicesOf(db).routes.listByContact(WS, CONTACT)
        expect(routes.map((route) => [route.channel, route.accountId]).toSorted()).toEqual([
            ["email", MAILBOX],
            ["zalo", expect.any(String)],
        ])
    })

    it("NEGATIVE: a mailbox with no inbound half is no entrance: the one send refuses `entrance_incomplete` (missing inbound), nothing is sent", async () => {
        const { db, mailsSent } = await mailboxWorld({ from_email: "shop@example.com" })
        const person = (await chatServicesOf(db).contacts.meetAddress(WS, "email", SENDER, true)) ?? ""
        db.model.script(ANSWER, { call: { tool: TOOL.customerMessageSend, args: { channel: "email", accountId: MAILBOX, subject: REPLY_SUBJECT, text: "Chao ban" } } }, { done: { reply: "Chao ban" } })
        const process = await processOf(db)

        const started = await startThread(process, {
            flow: oneSendFlow,
            versionId: "chatbot-agent:mail-out@1",
            workflowId: "wf:mail-out",
            trigger: { eventId: "tag:mail-out-1", contactId: person, data: { text: "Chao ban" }, locale: "vi" },
        })

        expect(started.error).toBeNull()
        expect(mailsSent()).toEqual([])
        expect(db.chat.ledger.rows.map((row) => [row.channel, row.accountId, row.state, row.reason])).toEqual([
            ["email", MAILBOX, "refused", "entrance_incomplete"],
        ])
        // The inbound half standing alone is no entrance either: it sends nothing on the channel (no send port of its provider).
        await expect(db.chat.channelDeliveries.get("email")?.entranceOf(WS, MAILBOX)).resolves.toBe("inbound")
    })
})

/** A one-step flow whose agent tells the run's person by mail (as mail-send.spec.ts). */
const oneSendFlow: GraphSpec = {
    schema: "nivo/agent-graph@1",
    moduleKey: "chatbot",
    trigger: { kind: "tag", sources: [] },
    grant: { tools: [TOOL.brainSearch], effects: [TOOL.customerMessageSend] },
    nodes: [{ key: "answer", kind: "output", step: "wdesk.answer", mode: "auto", params: { conversationId: "no-route", text: "Chao ban" } }],
}

/** The mail verb, as the SDK names it. */
const TRIGGER_MAIL = "nivo.trigger.mail.message.received"
