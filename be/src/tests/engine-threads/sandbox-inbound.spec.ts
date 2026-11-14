import type { RawBodyRequest } from "@nestjs/common"
import type { Request } from "express"
import type { EntityManager } from "typeorm"
import type { ClaimedJob } from "@modules/platform/jobs"
import { mock } from "@starci/jest-preset"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import type { Provider } from "@modules/domain/connections"
import { AccountDataAdmissionsService } from "@modules/domain/account-data"
import type { AccountDataIntakeService, AccountDataInput, AccountDataReadService, AccountDataTypeDef, PendingRow } from "@modules/domain/account-data"
import { ZaloStaleJudgeService } from "@modules/domain/zalo-provider"
import { GenericWebhookIntakeService, GenericWebhookJobService } from "@modules/domain/agent-inbound"
import { InboundDoorService } from "@modules/domain/agent-inbound/inbound-door.service"
import { InboundAdapterRegistryService } from "@modules/domain/agent-inbound/inbound-adapter-registry.service"
import type { AgentRunsService } from "@modules/domain/agent-runs"
import type { AgentEventWakesService } from "@modules/domain/agent-schedules"
import type { AgentWake, AgentWakeService, AgentWorkAccessService } from "@modules/domain/agent-work"
import { BANK_FEED_DATA_TYPES, BankFeedReceiptService, bankTransactionTriggerFor } from "@modules/domain/bank-feed-inbox"
import { triggerDeclarations } from "@modules/domain/provider-triggers"
import { BankFeedAdmissionService, BankFeedIntakeService, BankFeedReceiptsService, BankFeedService, type PaymentProofService } from "@modules/domain/billing"
import { BankFeedTriggerService } from "@modules/domain/billing/bank-feed-trigger.service"
import type { SepayConnectionService } from "@modules/domain/channel-connections"
import { ChannelsErrorCode, type ZaloCredentialsService } from "@modules/domain/channels"
import { ZaloProofService } from "@modules/domain/channels/zalo-proof.service"
import type { CustomerFilesService } from "@modules/domain/chat-files"
import type { PollScheduleService } from "@modules/domain/connection-poll"
import type { ConnectionBindingsReadService, ConnectionsService } from "@modules/domain/connections"
import type { InboundEventsService } from "@modules/domain/inbound-events"
import {
    ProviderSandboxAccountsService,
    SANDBOX_KEY_HEADER,
    SandboxCatalogueRegistryService,
    SandboxWebhookKeyService,
    type SandboxWebhookPost,
} from "@modules/domain/provider-sandbox"
import type { FeedWebhookRegistryService } from "@modules/domain/provider-registry"
import { SEPAY_SANDBOX_CATALOGUE, SepayFeedWebhookService } from "@modules/domain/sepay-provider"
import { WEBHOOK_SANDBOX_CATALOGUE } from "@modules/domain/webhook-connections"
import { ScopedWebhookVerifier } from "@modules/domain/webhook-proofs"
import type { WorkspacesService } from "@modules/domain/workspaces"
import { ZaloDeliveryIntakeService, ZaloInboxService } from "@modules/domain/zalo-inbox"
import { zaloEvent, zaloMessage, zaloUser } from "@modules/domain/zalo-inbox/zalo.data-types"
import { ZALO_SANDBOX_CATALOGUE } from "@modules/domain/zalo-provider"
import type { Ids } from "@modules/platform/ids"
import { HttpSecurityErrorCode } from "@modules/platform/http-security"
import { WebhookProofRegistryService } from "@modules/platform/http-security/webhook-proof-registry.service"
import type { MessageCatalog } from "@modules/platform/i18n"
import type { Logger } from "@modules/platform/logging"
import type { QueueOutbox } from "@modules/platform/queue"
import type { GenericWebhookPayload, GenericWebhookQueue } from "@modules/queues/generic-webhook"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { RecordingWebhookPoster, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { GenericWebhook } from "../../features/webhooks/generic/transport/http/generic.webhook"
import { SepayFeedWebhook } from "../../features/webhooks/sepay-feed/transport/http/sepay-feed.webhook"
import { ZaloWebhook } from "../../features/webhooks/zalo/transport/http/zalo.webhook"
import { chatServicesOf } from "./thread-world-intake"
import { WS } from "./thread-world-records"
import { ANSWER, FRONT, UNDERSTAND, customersSay, processOf, runHeard, threadDbOf, type ThreadDb } from "./thread-world"

// E-FIX10 / F-R6-1. RULE (engine words): a delivery to a SANDBOX account is proven by the sandbox key its route already checked; a
// provider's own proof (a signature or token under the account's secret) is asked only of a LIVE account; the proof is decided in ONE place
// (`ScopedWebhookVerifier`, the shared guard first) and its verdict travels with the delivery: no intake or job reads a secret again to learn
// whether, or for whom, a delivery was proven. Exposing case: a sandbox Zalo line (ZALO-1) was accepted at the door and completed at once by
// the intake (no OA secret = "unproven"): no wake, no line. Second kind: a sandbox bank credit (SEPAY-1). Third: a sandbox generic webhook
// event (WEBHOOK-1), whose job read the endpoint's secret only to learn its workspace. Every case goes through THE ONE SEND (the Sandbox
// doors build the case and post it), the REAL door, the REAL guard and verifier, the REAL intake and its REAL consumer; only the stores are
// doubles (the account rows in the world's memory, the transaction, the outbox).

const SBX_ZALO = "aaaaaaaa-1111-4111-8111-111111111111"
const LIVE_ZALO = "bbbbbbbb-2222-4222-8222-222222222222"
const SBX_SEPAY = "cccccccc-3333-4333-8333-333333333333"
const SBX_HOOK = "dddddddd-4444-4444-8444-444444444444"
const KEY = "sbx_key_world"
const NOW = new Date("2026-11-14T09:00:00.000Z")
const ACTOR = { principalId: "owner-1", workspaceId: WS }
const SALES = "sales-agent"
const OPS = "ops-agent"
const LINE = "Shop mo cua may gio?"
const REPLY = "Shop mo cua tu 8h den 21h a."

/** Every account of the world: the sandbox ones and one live Zalo OA (the only one holding a provider secret). */
const ACCOUNTS = [
    connectionRecord({ id: SBX_ZALO, workspaceId: WS, provider: "zalo_oa", sandbox: true }),
    connectionRecord({ id: LIVE_ZALO, workspaceId: WS, provider: "zalo_oa" }),
    connectionRecord({ id: SBX_SEPAY, workspaceId: WS, provider: "sepay", sandbox: true }),
    connectionRecord({ id: SBX_HOOK, workspaceId: WS, provider: "webhook", sandbox: true }),
]

/** The declared row types the doors of this world keep. */
const ROW_DEFS: ReadonlyArray<AccountDataTypeDef> = [zaloEvent, zaloMessage, zaloUser, ...BANK_FEED_DATA_TYPES]

/** A transaction double: its work runs at once on itself; a database function answers no row. */
const txManager = (): EntityManager => {
    const manager: EntityManager = mock<EntityManager>({
        transaction: ((run: (tx: EntityManager) => Promise<unknown>) => run(manager)) as EntityManager["transaction"],
        query: (() => Promise.resolve([])) as EntityManager["query"],
    })
    return manager
}

/**
 * The account store as the doors use it (`AccountDataIntakeService`), over the world's raw rows: a row is kept ONCE under its declared key
 * (a repeat answers not new), a `wakes` row stays pending until its consumer completes it.
 */
const accountStoreOf = (db: ThreadDb) => {
    const completed = new Set<string>()
    const providerOf = (connectionId: string): string | undefined => ACCOUNTS.find((one) => one.id === connectionId)?.provider
    const store = mock<AccountDataIntakeService>({
        write: (_tx: EntityManager, connectionId: string, rows: ReadonlyArray<AccountDataInput>) => {
            const provider = providerOf(connectionId)
            if (provider === undefined) return Promise.resolve({ owner: null, rows: [] })
            const written = rows.map((row) => {
                const value = Object.fromEntries(Object.entries(row.value)) as Record<string, unknown>
                const def = ROW_DEFS.find((one) => one.name === row.type)
                const key = (def?.key ?? []).map((member) => String(value[member] ?? "")).join(":")
                if (db.chat.raw.some((one) => one.connectionId === connectionId && one.type === row.type && one.key === key))
                    return { type: row.type, key, id: "", isNew: false }
                const id = `row-${db.chat.raw.length + 1}`
                db.chat.raw.push({ id, connectionId, type: row.type, key, value, occurredAt: NOW })
                return { type: row.type, key, id, isNew: true }
            })
            return Promise.resolve({ owner: { provider, connectionId, workspaceId: WS }, rows: written })
        },
        lockPending: (_tx: EntityManager, type: string, connectionId: string, key: string) => {
            const row = db.chat.raw.find((one) => one.connectionId === connectionId && one.type === type && one.key === key)
            const provider = providerOf(connectionId)
            if (row === undefined || provider === undefined || completed.has(row.id)) return Promise.resolve(null)
            const pending: PendingRow = { id: row.id, type, key, owner: { provider, connectionId, workspaceId: WS }, value: row.value as PendingRow["value"] }
            return Promise.resolve(pending)
        },
        complete: (_tx: EntityManager, pending: PendingRow) => {
            completed.add(pending.id)
            return Promise.resolve()
        },
    })
    return { store, completed }
}

/** The outbox double: every queued message, by queue. */
const outboxOf = () => {
    const queued: Array<{ readonly queue: string; readonly message: object }> = []
    const outbox = mock<QueueOutbox>({
        write: (_tx: EntityManager, queue: string, message: object) => {
            queued.push({ queue, message })
            return Promise.resolve()
        },
    })
    return { outbox, queued }
}

/** The connections the doors read: the sandbox key of each sandbox account, the intake read of any account of the world. */
const connectionsOf = () => {
    const connections = mock<ConnectionsService>()
    connections.authorize.mockResolvedValue({ role: "owner", displayName: "Lan" })
    connections.find.mockImplementation((_ws, id) => Promise.resolve(ACCOUNTS.find((one) => one.id === id) ?? null))
    connections.sandboxKeyOf.mockImplementation((_ws, id) => Promise.resolve(ACCOUNTS.some((one) => one.id === id && one.sandbox) ? KEY : null))
    connections.isSandboxKey.mockImplementation((id, presented) => ACCOUNTS.some((one) => one.id === id && one.sandbox) && presented === KEY)
    connections.intakeOf.mockImplementation((id, provider) => {
        const account = ACCOUNTS.find((one) => one.id === id && one.provider === provider)
        return Promise.resolve(
            account === undefined
                ? ({ kind: "refused", code: "CONNECTIONS_NOT_FOUND" } as Awaited<ReturnType<ConnectionsService["intakeOf"]>>)
                : { kind: "ok", value: { id, workspaceId: WS, status: "connected" } },
        )
    })
    connections.markReceived.mockResolvedValue(undefined)
    return connections
}

/** The status and body the HTTP route would answer for a door's call. */
const answered = async (call: () => Promise<unknown>, ok: number): Promise<{ readonly status: number; readonly body: unknown }> => {
    try {
        return { status: ok, body: (await call()) ?? null }
    } catch (cause) {
        return { status: 401, body: { code: (cause as { code?: string }).code } }
    }
}

/** The shared pieces every door of the world stands on: the guard, the verifier over the REAL proof registry, the stores. */
const worldOf = (db: ThreadDb) => {
    const connections = connectionsOf()
    const { sandbox, store: sandboxStore } = sandboxServiceOf(...ACCOUNTS)
    const guard = new SandboxWebhookKeyService(sandboxStore, { enabled: true }, connections)
    const logger = mock<Logger>()
    const registry = new WebhookProofRegistryService(db.clock, logger)
    // The live Zalo OA's own proof, REAL: the mac under the OA secret only the live account holds; a sandbox account holds none.
    const credentials = mock<ZaloCredentialsService>()
    credentials.load.mockImplementation((id) =>
        Promise.resolve(
            id === LIVE_ZALO
                ? { kind: "ok", value: { secret: { appId: "app-1", appSecret: "s", oaSecret: "oa-secret" }, expiresAt: null, workspaceId: WS } }
                : ({ kind: "refused", code: ChannelsErrorCode.ConnectionNotFound } as Awaited<ReturnType<ZaloCredentialsService["load"]>>),
        ),
    )
    new ZaloProofService(registry, logger, credentials).onModuleInit()
    const verifier = new ScopedWebhookVerifier(registry, guard)
    const accounts = accountStoreOf(db)
    const { outbox, queued } = outboxOf()
    const schedule = mock<PollScheduleService>({ recordWebhook: () => Promise.resolve() })
    const catalogues = new SandboxCatalogueRegistryService()
    return { connections, sandbox, guard, logger, verifier, credentials, accounts, outbox, queued, schedule, catalogues }
}

type World = ReturnType<typeof worldOf>

/** The delivery job row every consumer of this world runs under. */
const DELIVERY_JOB: ClaimedJob = { jobId: "job-1", kind: "delivery", fencingToken: 1, currentStep: null, payload: {} }

/** The Zalo OA door, its REAL intake and its REAL consumer (`ZaloInboxService.processRecordedDelivery`). */
const zaloRoadOf = (db: ThreadDb, world: World) => {
    const inbox = new ZaloInboxService(
        txManager(),
        mock<InboundEventsService>(),
        world.outbox,
        world.accounts.store,
        mock<AccountDataReadService>({ get: () => Promise.resolve(null) }),
        db.clock,
        world.logger,
        world.connections,
        world.credentials,
        mock<CustomerFilesService>({ keep: () => Promise.resolve([]) }),
        chatServicesOf(db).triggers,
        mock<MessageCatalog>({ get: () => "Khach Zalo" }),
        new AccountDataAdmissionsService(),
        mock<ZaloStaleJudgeService>({ isStale: () => false }),
    )
    inbox.onModuleInit()
    const door = new ZaloWebhook(world.verifier, new ZaloDeliveryIntakeService(inbox, world.schedule))
    const route = (call: SandboxWebhookPost) =>
        answered(
            () =>
                door.receive(
                    mock<RawBodyRequest<Request>>({ rawBody: Buffer.from(JSON.stringify(call.body)) }),
                    { connectionId: call.path.split("/").at(-1) ?? "" },
                    call.headers["x-zevent-signature"],
                    call.headers[SANDBOX_KEY_HEADER],
                ),
            200,
        )
    world.catalogues.register(ZALO_SANDBOX_CATALOGUE)
    const doors = new ProviderSandboxAccountsService(world.connections, world.sandbox, world.catalogues, new RecordingWebhookPoster(route), { now: () => NOW })
    /** The queue's consumer: every queued Zalo delivery processed once. */
    const consume = async (): Promise<void> => {
        for (const { message } of world.queued.splice(0)) await inbox.processRecordedDelivery(message as { deliveryId: string }, DELIVERY_JOB)
    }
    return { doors, route, consume }
}

/** The model's answers of the question route: the understand step routes to `answer`, whose agent searches once and answers. */
const scriptQuestion = (db: ThreadDb): void => {
    db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Khach: gio mo cua" } })
    db.model.script(ANSWER, { call: { tool: TOOL.brainSearch, args: { query: "gio mo cua" } } }, { done: { reply: REPLY } })
}

/** Attaches one more account of a provider to an agent. */
const attach = (db: ThreadDb, agentId: string, connectionId: string, provider: Provider): void => {
    if (!db.rights.accounts.some((one) => one.id === connectionId)) db.rights.accounts.push({ id: connectionId, provider })
    db.rights.attachments.push({ agentId, connectionId, provider })
}

describe("sandbox inbound: the sandbox key proves the delivery, the intake obeys the door (exposing kind: a customer line)", () => {
    it("ZALO-1 to a sandbox Zalo account becomes a wake, the run stores the customer line and the reply goes out", async () => {
        const db = threadDbOf()
        attach(db, FRONT, SBX_ZALO, "zalo_oa")
        scriptQuestion(db)
        const process = await processOf(db)
        const world = worldOf(db)
        const zalo = zaloRoadOf(db, world)
        const before = db.chat.wakes.length

        const sent = await zalo.doors.send(ACTOR, SBX_ZALO, "ZALO-1", { userId: "8800110022", text: LINE })
        await zalo.consume()

        // The account holds NO OA secret (a sandbox account never does): the sandbox key alone proved the delivery.
        expect(await world.credentials.load(SBX_ZALO)).toMatchObject({ kind: "refused" })
        expect(sent.deliveries).toEqual([{ path: `api/connections/zalo/${SBX_ZALO}`, status: 200, body: null }])
        const wakes = db.chat.wakes.slice(before)
        expect(wakes).toHaveLength(1)
        expect(wakes[0]?.context).toMatchObject({ connectionId: SBX_ZALO, workflowId: expect.any(String), rawType: "zalo_oa.event" })
        expect(world.accounts.completed.size).toBe(1)

        const woken = await runHeard(process, wakes)
        expect(woken.error).toBeNull()
        expect(woken.ending).toMatchObject({ status: "done" })
        expect(db.chat.lines.heard.map((line) => [line.text, line.accountId])).toEqual([[LINE, SBX_ZALO]])
        expect(db.chat.ledger.rows.map((row) => [row.state, row.text])).toEqual([["delivered", REPLY]])
    })

    it("negative: the sandbox account's route WITHOUT its key (a wrong key, or none) is refused and keeps nothing", async () => {
        const db = threadDbOf()
        attach(db, FRONT, SBX_ZALO, "zalo_oa")
        const world = worldOf(db)
        const zalo = zaloRoadOf(db, world)
        const body = { event_name: "user_send_text", sender: { id: "u-1" }, message: { msg_id: "m-x", text: LINE }, timestamp: String(NOW.getTime()) }

        await expect(zalo.route({ path: `api/connections/zalo/${SBX_ZALO}`, body, headers: { [SANDBOX_KEY_HEADER]: "wrong" } })).resolves.toEqual({
            status: 401,
            body: { code: "PROVIDER_SANDBOX_WEBHOOK_KEY_REFUSED" },
        })
        await expect(zalo.route({ path: `api/connections/zalo/${SBX_ZALO}`, body, headers: {} })).resolves.toEqual({
            status: 401,
            body: { code: "PROVIDER_SANDBOX_WEBHOOK_KEY_REFUSED" },
        })
        expect(db.chat.raw).toEqual([])
        expect(world.queued).toEqual([])
    })

    it("negative: a LIVE account never takes the sandbox key instead of its own proof (no mac: refused; its OA secret is asked)", async () => {
        const db = threadDbOf()
        const world = worldOf(db)
        const zalo = zaloRoadOf(db, world)
        const body = { event_name: "user_send_text", app_id: "app-1", sender: { id: "u-1" }, message: { msg_id: "m-y", text: LINE }, timestamp: String(NOW.getTime()) }

        await expect(zalo.route({ path: `api/connections/zalo/${LIVE_ZALO}`, body, headers: { [SANDBOX_KEY_HEADER]: KEY } })).resolves.toEqual({
            status: 401,
            body: { code: HttpSecurityErrorCode.WebhookSignatureInvalid },
        })
        expect(world.credentials.load).toHaveBeenCalledWith(LIVE_ZALO)
        expect(db.chat.raw).toEqual([])
        expect(world.queued).toEqual([])
    })
})

describe("sandbox inbound, second kind: a bank credit", () => {
    it("SEPAY-1 to a sandbox SePay account becomes a wake taken by the credit registration of the agent it is attached to", async () => {
        const db = threadDbOf({ modules: { [SALES]: "sales" } })
        attach(db, SALES, SBX_SEPAY, "sepay")
        const process = await processOf(db)
        await customersSay(process, [])
        const world = worldOf(db)
        // The bank feed's declaration, as the app registers it at boot.
        const declaration = bankTransactionTriggerFor("sepay")
        if (declaration !== null) triggerDeclarations.register(declaration)
        // The bank feeds' admission, as the app registers it at boot: a new movement queues its delivery job in the door's transaction.
        const admissions = new AccountDataAdmissionsService()
        new BankFeedAdmissionService(admissions, world.outbox).onModuleInit()
        const receipts = new BankFeedReceiptService(world.accounts.store, admissions, world.logger)
        const port = new SepayFeedWebhookService(
            mock<SepayConnectionService>({ traceIntake: (_c: string, _raw: unknown, run: () => Promise<void>) => run() }),
            mock<FeedWebhookRegistryService>(),
        )
        const proof = mock<PaymentProofService>()
        const feed = new BankFeedReceiptsService(txManager(), proof, receipts, mock<FeedWebhookRegistryService>({ liveOf: () => port }))
        const door = new SepayFeedWebhook(feed, new BankFeedIntakeService(feed, world.schedule), world.guard)
        const trigger = new BankFeedTriggerService(
            mock<ConnectionBindingsReadService>({ stateOf: () => Promise.resolve({ name: SBX_SEPAY, environment: "live" }) }),
            chatServicesOf(db).triggers,
        )
        const bank = new BankFeedService(txManager(), db.clock, receipts, trigger)
        const route = (call: SandboxWebhookPost) =>
            answered(
                () =>
                    door.receive(
                        mock<RawBodyRequest<Request>>({ rawBody: Buffer.from(JSON.stringify(call.body)) }),
                        call.path.split("/").at(-1) ?? "",
                        call.headers.authorization,
                        call.headers[SANDBOX_KEY_HEADER],
                    ),
                200,
            )
        world.catalogues.register(SEPAY_SANDBOX_CATALOGUE)
        const doors = new ProviderSandboxAccountsService(world.connections, world.sandbox, world.catalogues, new RecordingWebhookPoster(route), { now: () => NOW })
        const before = db.chat.wakes.length

        const sent = await doors.send(ACTOR, SBX_SEPAY, "SEPAY-1", { content: "NIVO DH1001", amount: 350_000 })
        for (const { message } of world.queued.splice(0)) await bank.processRecordedFeedDelivery(message as { provider: "sepay-feed"; deliveryId: string })

        expect(sent.deliveries.map((one) => one.status)).toEqual([200])
        // No provider proof was asked of the sandbox account (it holds no API key): the sandbox key proved it.
        expect(proof.proveFeed).not.toHaveBeenCalled()
        expect(world.logger.error).not.toHaveBeenCalled()
        const taken = db.chat.wakes.slice(before).filter((wake) => wake.agentId === SALES && wake.context.workflowId !== undefined)
        expect(taken).toHaveLength(1)
        expect(taken[0]?.context).toMatchObject({ connectionId: SBX_SEPAY })
    })
})

describe("sandbox inbound, third kind: a generic webhook event", () => {
    it("WEBHOOK-1 to a sandbox endpoint becomes a wake: its job reads the endpoint's workspace from the connection row, never a secret", async () => {
        const db = threadDbOf()
        const world = worldOf(db)
        const claimed = new Set<string>()
        const account = mock<AccountDataIntakeService>({
            claim: (_tx: EntityManager, claim: { readonly connectionId: string; readonly type: string; readonly value: object }) => {
                const key = `${claim.connectionId}:${String(Reflect.get(claim.value, "deliveryId"))}`
                if (claimed.has(key)) return Promise.resolve(undefined)
                claimed.add(key)
                return Promise.resolve({ type: claim.type, key, id: `row-${claimed.size}`, isNew: true })
            },
        })
        const jobs: Array<GenericWebhookPayload> = []
        const queue = mock<GenericWebhookQueue>({
            enqueueDeliver: (payload: GenericWebhookPayload) => {
                jobs.push(payload)
                return Promise.resolve()
            },
        })
        const door = new GenericWebhook(world.verifier, new GenericWebhookIntakeService(txManager(), account, queue))
        const written: Array<AgentWake> = []
        const inbound = new InboundDoorService(
            mock<Ids>({ next: () => "chain-1" }),
            world.logger,
            new InboundAdapterRegistryService(),
            mock<AgentEventWakesService>({ agentsFor: () => Promise.resolve([{ agentId: OPS }]) }),
            mock<AgentWorkAccessService>(),
            mock<AgentWakeService>({
                write: (_tx: EntityManager, wake: AgentWake) => {
                    written.push(wake)
                    return Promise.resolve(`wake-${written.length}`)
                },
            }),
            mock<AgentRunsService>({ open: () => Promise.resolve(undefined as never) }),
            mock<WorkspacesService>({ isLive: () => Promise.resolve(true) }),
        )
        const job = new GenericWebhookJobService(txManager(), world.logger, world.connections, inbound)
        const route = (call: SandboxWebhookPost) =>
            answered(
                () =>
                    door.receive(
                        mock<RawBodyRequest<Request>>({ rawBody: Buffer.from(JSON.stringify(call.body)) }),
                        { connectionId: call.path.split("/").at(-1) ?? "" },
                        call.headers["x-signature"],
                        call.headers["x-event-type"],
                        call.headers["x-idempotency-key"],
                        call.headers[SANDBOX_KEY_HEADER],
                    ),
                202,
            )
        world.catalogues.register(WEBHOOK_SANDBOX_CATALOGUE)
        const doors = new ProviderSandboxAccountsService(world.connections, world.sandbox, world.catalogues, new RecordingWebhookPoster(route), { now: () => NOW })

        const sent = await doors.send(ACTOR, SBX_HOOK, "WEBHOOK-1", { type: "invoice.paid", reference: "INV-1001" })
        for (const payload of jobs.splice(0)) await job.run({ ...DELIVERY_JOB, payload })

        expect(sent.deliveries.map((one) => one.status)).toEqual([202])
        expect(world.connections.intakeOf).toHaveBeenCalledWith(SBX_HOOK, "webhook")
        expect(written).toHaveLength(1)
        expect(written[0]).toMatchObject({ workspaceId: WS, agentId: OPS, source: "generic_webhook", context: expect.objectContaining({ eventName: "invoice.paid" }) })
    })
})
