import type { EntityManager } from "typeorm"
import { mock, mockEntityManager } from "@starci/jest-preset"
import { TRIGGER } from "@nivo-lite/agent-sdk/names"
import { AccountDataAdmissionsService } from "@modules/domain/account-data"
import type {
    AccountDataFactsService,
    AccountDataInput,
    AccountDataIntakeService,
    PendingRow,
} from "@modules/domain/account-data"
import type { AgentWake, AgentWakeService } from "@modules/domain/agent-work"
import { burstFor } from "@modules/domain/agent-work/agent-work.policy"
import { BankFeedReceiptService, bankTransactionTriggerFor } from "@modules/domain/bank-feed-inbox"
import { BankFeedAdmissionService, BankFeedReceiptsService, BankFeedService, type PaymentProofService } from "@modules/domain/billing"
import { BankFeedTriggerService } from "@modules/domain/billing/bank-feed-trigger.service"
import type { SepayConnectionService } from "@modules/domain/channel-connections"
import { ConnectionPollRunService, PollReceiptsService, emptyPollSummary, type PollSummary } from "@modules/domain/connection-poll"
import type { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import type { ConnectionBindingsReadService, ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import type { FeedWebhookRegistryService } from "@modules/domain/provider-registry"
import {
    ProviderTriggersService,
    triggerDeclarations,
    type DeliverResult,
    type ProviderTriggerReceivers,
} from "@modules/domain/provider-triggers"
import { SepayFeedWebhookService } from "@modules/domain/sepay-provider"
import { SepayTransactionReceiverService } from "@modules/domain/sepay-provider/sepay-transaction-receiver.service"
import { SepayError, SepayErrorCode, type SepayClient, type SepayTransaction } from "@modules/integrations/sepay"
import type { Logger } from "@modules/platform/logging"
import type { QueueOutbox } from "@modules/platform/queue"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { ChatWorld } from "./thread-world-chat"
import { chatServicesOf, connectionRecordOf, wakeQueueOf } from "./thread-world-intake"
import { TickingClock } from "./thread-world-outside"
import { WS } from "./thread-world-records"
import { customersSay, processOf, threadDbOf } from "./thread-world"

// PHASE B of TL-S3: THE PROOF WORLDS OF A BANK CREDIT, on the ONE road after the intake (owner R95) and the same-fact key (owner R97).
// A SePay account S and a Casso account C of one workspace; one agent attached to both with a payment registration.
// REAL: the three bank declarations (translate, factKey), the webhook doors' intake (`BankFeedReceiptsService`, the SePay webhook port's
// reading, Casso's reading), `BankFeedReceiptService.keep` / lock / complete, the admission (`BankFeedAdmissionService` over the real
// `AccountDataAdmissionsService`), the delivery consumer (`BankFeedService`, `BankFeedTriggerService`), the REAL `ProviderTriggersService.deliver`
// (switch, MATCH, the fact claim and its `sameFact` answer, the wake write), the SePay poll receiver (`SepayTransactionReceiverService`),
// the generic store (`PollReceiptsService`) and the walk (`ConnectionPollRunService`).
// DOUBLES: the account store (rows in memory: one row per (type, connection, key), as the unique key does), `AccountDataFactsService` (in memory,
// the same claim rule: first claim under a per-key lock wins, a repeated claim answers as before; the REAL advisory lock and the real
// race of two database transactions are NOT exercised), the transaction (runs at once on itself), the queue outbox, the SePay client, the
// connection tokens, the registration (a receivers stub), the wake table (the world's), the scheduler's backoff (planned by
// `PollSchedulerService`, covered by its own spec, not here).

const S = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const S2 = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa"
const C = "cccccccc-1111-4111-8111-cccccccccccc"
const PAYMENT = "wf-payment"
const ACCOUNT_NUMBER = "0011004455667"
const ACCOUNTS: ReadonlyArray<{ readonly id: string; readonly provider: string }> = [
    { id: S, provider: "sepay" },
    { id: S2, provider: "sepay" },
    { id: C, provider: "casso" },
]

/** One row of the account store double. */
interface Kept {
    readonly id: string
    readonly connectionId: string
    readonly type: string
    readonly key: string
    readonly value: Readonly<Record<string, unknown>>
    processed: boolean
    factKey: string | null
    sameFactOf: string | null
}

/** A transaction double: its work runs at once on itself; a database function answers no row. */
const txManager = (): EntityManager => {
    const manager: EntityManager = mock<EntityManager>({
        transaction: ((run: (tx: EntityManager) => Promise<unknown>) => run(manager)) as EntityManager["transaction"],
        query: (() => Promise.resolve([])) as EntityManager["query"],
    })
    return manager
}

/** The account store as the intake keeps it: ONE row per (type, connection, key); a `wakes` row stays pending until its consumer completes it. */
const storeOf = () => {
    const rows: Array<Kept> = []
    const intake = mock<AccountDataIntakeService>({
        write: async (_tx: EntityManager, connectionId: string, inputs: ReadonlyArray<AccountDataInput>) => {
            const account = ACCOUNTS.find((one) => one.id === connectionId)
            if (account === undefined) return { owner: null, rows: [] }
            await Promise.resolve()
            const written = inputs.map((input) => {
                const value = Object.fromEntries(Object.entries(input.value)) as Record<string, unknown>
                const key = String(value.transactionId)
                if (rows.some((row) => row.connectionId === connectionId && row.type === input.type && row.key === key)) {
                    return { type: input.type, key, id: "", isNew: false }
                }
                const id = `row-${rows.length + 1}`
                rows.push({ id, connectionId, type: input.type, key, value, processed: false, factKey: null, sameFactOf: null })
                return { type: input.type, key, id, isNew: true }
            })
            return { owner: { provider: account.provider, connectionId, workspaceId: WS }, rows: written }
        },
        lockPending: (_tx: EntityManager, type: string, connectionId: string, key: string) => {
            const row = rows.find((one) => one.connectionId === connectionId && one.type === type && one.key === key && !one.processed)
            const account = ACCOUNTS.find((one) => one.id === connectionId)
            if (row === undefined || account === undefined) return Promise.resolve(null)
            const pending: PendingRow = {
                id: row.id,
                type,
                key,
                owner: { provider: account.provider, connectionId, workspaceId: WS },
                value: row.value as PendingRow["value"],
            }
            return Promise.resolve(pending)
        },
        complete: (_tx: EntityManager, pending: PendingRow) => {
            const row = rows.find((one) => one.id === pending.id)
            if (row !== undefined) row.processed = true
            return Promise.resolve()
        },
    })
    return { rows, intake }
}

/**
 * `AccountDataFactsService` in memory, with its real rule (account-data-facts.service): a per-key lock (here a promise chain), the FIRST row
 * that carries the key and no `sameFactOf` is the first, a claim repeated by the same row answers as before.
 */
const factsOf = (rows: Array<Kept>) => {
    const locks = new Map<string, Promise<unknown>>()
    const claims: Array<string> = []
    const claim = jest.fn(async (_tx: EntityManager, input: { workspaceId: string; type: string; id: string; factKey: string }) => {
        const before = locks.get(input.factKey) ?? Promise.resolve()
        const run = before.then(async () => {
            await Promise.resolve()
            claims.push(input.id)
            const self = rows.find((row) => row.id === input.id)
            if (self === undefined) throw new Error("claim of a row nobody kept")
            if (self.factKey === input.factKey) {
                const first = rows.find((row) => row.id === self.sameFactOf)
                return first === undefined ? { first: true as const } : { first: false as const, sameAs: { type: first.type, id: first.id } }
            }
            const earlier = rows.find((row) => row.factKey === input.factKey && row.sameFactOf === null && row.id !== self.id)
            self.factKey = input.factKey
            self.sameFactOf = earlier?.id ?? null
            return earlier === undefined ? { first: true as const } : { first: false as const, sameAs: { type: earlier.type, id: earlier.id } }
        })
        locks.set(input.factKey, run.catch(() => undefined))
        return run
    })
    return { facts: { claim } as unknown as AccountDataFactsService, claim, claims }
}

/** The world: both feeds' doors, the delivery consumer, the poll, the real `deliver` and the wake table. */
const worldOf = () => {
    const chat = new ChatWorld()
    for (const provider of ["sepay", "casso"]) {
        const declaration = bankTransactionTriggerFor(provider)
        if (declaration === null) throw new Error(`no ${provider} declaration`)
        triggerDeclarations.register(declaration)
    }
    const clock = new TickingClock()
    const logger = mock<Logger>()
    const { rows, intake } = storeOf()
    const { facts, claim } = factsOf(rows)
    const queued: Array<{ readonly provider: "sepay-feed" | "casso" | "payos"; readonly deliveryId: string }> = []
    const outbox = mock<QueueOutbox>({
        write: (_tx: EntityManager, _queue: string, message: object) => {
            queued.push(message as (typeof queued)[number])
            return Promise.resolve()
        },
    })
    const wakes = mock<AgentWakeService>({
        ...wakeQueueOf(chat),
        write: (_tx: unknown, wake: AgentWake) => {
            if (chat.wakes.some((one) => one.agentId === wake.agentId && one.eventKey === wake.eventKey)) return Promise.resolve(null)
            const id = `credit-wake-${chat.wakes.length + 1}`
            chat.wakes.push({
                ...structuredClone(wake),
                scopeKey: wake.scopeKey ?? "agent",
                id,
                createdAt: new Date(Date.UTC(2026, 10, 14, 10, 0, 0, chat.wakes.length)),
                state: "pending",
                burst: wake.settle === undefined ? null : burstFor(wake.settle),
            })
            return Promise.resolve(id)
        },
    })
    const receivers = mock<ProviderTriggerReceivers>({
        attachedTo: () => Promise.resolve(["sales"]),
        takerOf: () => Promise.resolve({ workflowId: PAYMENT, ownKey: "data.transactionId" }),
    })
    const bindings = mock<ConnectionBindingsReadService>({
        recordOf: (workspaceId: string, id: string) =>
            Promise.resolve(connectionRecordOf(workspaceId, { id, provider: ACCOUNTS.find((one) => one.id === id)?.provider ?? "sepay" })),
        stateOf: () => Promise.resolve({ name: "Bank", environment: "live" }),
    })
    type Store = ConstructorParameters<typeof ProviderTriggersService>[3]
    const triggers = new ProviderTriggersService(
        mockEntityManager(),
        clock,
        logger,
        mock<Store>({
            find: (_tx: unknown, connectionId: string, name: string) =>
                Promise.resolve(mock<NonNullable<Awaited<ReturnType<Store["find"]>>>>({ id: `switch:${connectionId}:${name}`, workspaceId: WS, enabled: true, enabledAt: null })),
            markFired: () => Promise.resolve(),
        }),
        bindings,
        receivers,
        null,
        undefined,
        undefined,
        wakes,
        undefined,
        facts,
    )
    const results: Array<DeliverResult> = []
    const deliver = triggers.deliver.bind(triggers)
    jest.spyOn(triggers, "deliver").mockImplementation(async (...args: Parameters<typeof deliver>) => {
        const result = await deliver(...args)
        results.push(result)
        return result
    })
    // The doors and the consumer, wired as the app wires them.
    const admissions = new AccountDataAdmissionsService()
    new BankFeedAdmissionService(admissions, outbox).onModuleInit()
    const receipts = new BankFeedReceiptService(intake, admissions, logger)
    const port = new SepayFeedWebhookService(
        mock<SepayConnectionService>({ traceIntake: (_c: string, _raw: unknown, run: () => Promise<void>) => run() }),
        mock<FeedWebhookRegistryService>(),
    )
    const door = new BankFeedReceiptsService(txManager(), mock<PaymentProofService>(), receipts, mock<FeedWebhookRegistryService>({ liveOf: () => port }))
    const bank = new BankFeedService(txManager(), clock, receipts, new BankFeedTriggerService(bindings, triggers))
    /** The delivery job's consumer: every queued delivery processed once, in order (one at a time). */
    const consume = async (): Promise<void> => {
        for (const message of queued.splice(0)) await bank.processRecordedFeedDelivery(message)
    }
    /** The same, the jobs of the batch running at the same time (two workers). */
    const consumeTogether = async (): Promise<void> => {
        await Promise.all(queued.splice(0).map((message) => bank.processRecordedFeedDelivery(message)))
    }
    // The poll: the SePay receiver over a client double, the generic store, the walk.
    const sepay = mock<SepayClient>()
    const tokens = mock<ConnectionApiTokenService>({ read: () => Promise.resolve("token") })
    const receiver = new SepayTransactionReceiverService(sepay, tokens)
    const store = new PollReceiptsService(txManager(), intake, admissions)
    const walker = new ConnectionPollRunService({
        clock,
        logger,
        connections: mock<ConnectionsService>({ get: () => Promise.resolve({ meta: {} }), patch: () => Promise.resolve() }),
    } as ConstructorParameters<typeof ConnectionPollRunService>[0])
    const poll = async (record: ConnectionRecord): Promise<{ readonly outcome: Awaited<ReturnType<ConnectionPollRunService["poll"]>>; readonly summary: PollSummary }> => {
        const summary = emptyPollSummary()
        const outcome = await walker.poll(
            { read: (account, window) => receiver.read(account, window), keep: (account, listed) => store.keep(account, receiver.dataType, listed) },
            record,
            summary,
        )
        return { outcome, summary }
    }
    const records = {
        s: connectionRecord({ id: S, workspaceId: WS, provider: "sepay", meta: { account_number: ACCOUNT_NUMBER } }),
        s2: connectionRecord({ id: S2, workspaceId: WS, provider: "sepay", meta: { account_number: ACCOUNT_NUMBER } }),
    }
    return { chat, rows, queued, results, claim, door, consume, consumeTogether, sepay, receiver, poll, records, facts }
}

type World = ReturnType<typeof worldOf>

/** The body SePay's webhook posts for a transfer in. */
const sepayBody = (id: number, amount: number, reference?: string): Buffer =>
    Buffer.from(
        JSON.stringify({
            id,
            gateway: "Vietcombank",
            transferType: "in",
            transferAmount: amount,
            content: "NIVO DH1001",
            accountNumber: ACCOUNT_NUMBER,
            transactionDate: "2026-11-14 10:00:00",
            ...(reference === undefined ? {} : { referenceCode: reference }),
        }),
    )

/** The body Casso's webhook (V2) posts for a transfer in. */
const cassoBody = (id: number, amount: number, reference?: string): Buffer =>
    Buffer.from(
        JSON.stringify({
            error: 0,
            data: {
                id,
                amount,
                description: "NIVO DH1001",
                bankName: "Vietcombank",
                accountNumber: ACCOUNT_NUMBER,
                transactionDateTime: "2026-11-14 10:00:00",
                ...(reference === undefined ? {} : { reference }),
            },
        }),
    )

/** The row SePay's transactions list gives for the same transfer. */
const listed = (id: string, amount: number, reference?: string): SepayTransaction => ({
    id,
    occurredAt: new Date("2026-11-14T03:00:00.000Z"),
    amountIn: amount,
    amountOut: 0,
    content: "NIVO DH1001",
    code: null,
    bank: "Vietcombank",
    account: ACCOUNT_NUMBER,
    ...(reference === undefined ? {} : { reference }),
})

const sepayWebhook = (w: World, id: number, amount: number, reference?: string) => w.door.acceptFeedDelivery(sepayBody(id, amount, reference), S, "sepay")
const cassoWebhook = (w: World, id: number, amount: number, reference?: string) => w.door.acceptCassoDelivery(cassoBody(id, amount, reference), C)

describe("bank credit proof world, second kind (R95): one road after the intake, whichever way brought the movement", () => {
    it("(a) the webhook never came: the poll's row -> ONE admission -> ONE delivery job -> ONE wake; the late webhook of the same transfer does nothing", async () => {
        const w = worldOf()
        w.sepay.listTransactions.mockResolvedValue([listed("501", 200_000, "FT1")])

        const { outcome, summary } = await w.poll(w.records.s)

        expect(outcome).toMatchObject({ kind: "done", fetched: 1, recorded: 1 })
        expect(summary).toMatchObject({ connections: 1, fetched: 1, recorded: 1, failed: 0 })
        expect(w.rows).toHaveLength(1)
        expect(w.rows[0]).toMatchObject({ type: "sepay.transaction", key: "sepay:501", value: expect.objectContaining({ source: "poll", amount: 200_000 }) })
        expect(w.queued).toEqual([{ provider: "sepay-feed", deliveryId: `${S}:sepay:501` }])

        await w.consume()

        expect(w.chat.wakes).toHaveLength(1)
        expect(w.chat.wakes[0]?.context).toMatchObject({ eventId: "sepay:501", connectionId: S })
        expect(w.rows[0]?.processed).toBe(true)

        // The late webhook of the same transfer: the intake finds the row kept, nothing is admitted, nothing is queued, no second wake.
        await sepayWebhook(w, 501, 200_000, "FT1")
        expect(w.rows).toHaveLength(1)
        expect(w.queued).toEqual([])
        await w.consume()
        expect(w.chat.wakes).toHaveLength(1)
        // And a second poll of the same window keeps nothing new either.
        const again = await w.poll(w.records.s)
        expect(again.outcome).toMatchObject({ kind: "done", recorded: 0 })
        expect(w.queued).toEqual([])
    })

    it("(b) the webhook and the poll race for one transfer: ONE row, ONE job, ONE wake", async () => {
        const w = worldOf()
        w.sepay.listTransactions.mockResolvedValue([listed("502", 150_000, "FT2")])

        await Promise.all([sepayWebhook(w, 502, 150_000, "FT2"), w.poll(w.records.s)])
        await w.consume()

        expect(w.rows.filter((row) => row.key === "sepay:502")).toHaveLength(1)
        expect(w.chat.wakes).toHaveLength(1)
        expect(w.results.map((result) => [result.events, result.sameFact])).toEqual([[1, 0]])
    })

    it("(c) a read that fails answers the typed failure, classifies as transient, and the next account goes on", async () => {
        const w = worldOf()
        const down = new SepayError({ code: SepayErrorCode.Unavailable })
        w.sepay.listTransactions.mockRejectedValueOnce(down).mockResolvedValueOnce([listed("503", 99_000, "FT3")])

        const first = await w.poll(w.records.s)
        const second = await w.poll(w.records.s2)

        expect(first.outcome).toEqual({ kind: "failed", cause: down })
        expect(first.summary).toMatchObject({ connections: 1, failed: 1, recorded: 0 })
        expect(w.receiver.classify(down)).toEqual({ kind: "transient" })
        expect(w.receiver.classify(new SepayError({ code: SepayErrorCode.RateLimited, params: { retryAfterSeconds: 9 } }))).toEqual({ kind: "rate_limited", retryAfterSeconds: 9 })
        expect(second.outcome).toMatchObject({ kind: "done", recorded: 1 })
        await w.consume()
        expect(w.chat.wakes).toHaveLength(1)
        expect(w.rows.map((row) => row.connectionId)).toEqual([S2])
    })
})

describe("bank credit proof world, R97: one transfer reported by two feeds is ONE fact", () => {
    it("(d) a SePay account and a Casso account on one bank account report ONE transfer (same account number + bank reference): two raw rows, ONE wake, the second recorded as the same fact", async () => {
        const w = worldOf()

        await sepayWebhook(w, 601, 200_000, "FT9001")
        await cassoWebhook(w, 7001, 200_000, "FT9001")
        await w.consume()

        // Two raw rows (account-data rule 3: nothing merged at ingest), one of each feed.
        expect(w.rows.map((row) => row.type)).toEqual(["sepay.transaction", "casso.transaction"])
        // ONE wake, for the first report; the second was counted as the same fact and not delivered.
        expect(w.chat.wakes).toHaveLength(1)
        expect(w.chat.wakes[0]?.context).toMatchObject({ eventId: "sepay:601" })
        expect(w.results.map((result) => [result.events, result.sameFact, result.dropped])).toEqual([
            [1, 0, 0],
            [0, 1, 0],
        ])
        // The key is the verb and the source's identity; the second row points at the first.
        expect(w.rows[0]?.factKey).toBe(`${TRIGGER.paymentCreditReceived}:${ACCOUNT_NUMBER}:FT9001`)
        expect(w.rows[1]?.factKey).toBe(w.rows[0]?.factKey)
        expect(w.rows[0]?.sameFactOf).toBeNull()
        expect(w.rows[1]?.sameFactOf).toBe(w.rows[0]?.id)
        // Both rows were completed (the Casso job did not fail: a same-fact movement is a normal ending).
        expect(w.rows.every((row) => row.processed)).toBe(true)
    })

    it("(e) two DIFFERENT transfers of the same amount and words (two bank references) are two facts: two wakes, none recorded as the same", async () => {
        const w = worldOf()

        await sepayWebhook(w, 602, 200_000, "FT9002")
        await cassoWebhook(w, 7002, 200_000, "FT9003")
        await w.consume()

        expect(w.chat.wakes).toHaveLength(2)
        expect(w.results.map((result) => result.sameFact)).toEqual([0, 0])
        expect(w.rows.map((row) => row.sameFactOf)).toEqual([null, null])
        expect(w.rows.map((row) => row.factKey)).toEqual([`${TRIGGER.paymentCreditReceived}:${ACCOUNT_NUMBER}:FT9002`, `${TRIGGER.paymentCreditReceived}:${ACCOUNT_NUMBER}:FT9003`])
    })

    it("a movement that gives no bank reference is its own fact: no claim is asked, two wakes", async () => {
        const w = worldOf()

        await sepayWebhook(w, 603, 200_000)
        await cassoWebhook(w, 7003, 200_000)
        await w.consume()

        expect(w.claim).not.toHaveBeenCalled()
        expect(w.chat.wakes).toHaveLength(2)
    })

    it("(f) the two reports race (two workers consume the two jobs at the same time): ONE wake, one first and one same-fact (in-memory lock; the real advisory lock is not exercised)", async () => {
        const w = worldOf()

        await Promise.all([sepayWebhook(w, 604, 200_000, "FT9004"), cassoWebhook(w, 7004, 200_000, "FT9004")])
        expect(w.rows).toHaveLength(2)
        await w.consumeTogether()

        expect(w.chat.wakes).toHaveLength(1)
        expect(w.results.map((result) => result.sameFact).sort()).toEqual([0, 1])
        expect(w.rows.filter((row) => row.sameFactOf === null)).toHaveLength(1)
        expect(w.rows.filter((row) => row.sameFactOf !== null)).toHaveLength(1)
    })

    it("a redelivered job of the first report goes on and a redelivered job of the second stays one: the claim answers as before", async () => {
        const w = worldOf()
        await sepayWebhook(w, 605, 200_000, "FT9005")
        await cassoWebhook(w, 7005, 200_000, "FT9005")
        const jobs = [...w.queued]
        await w.consume()
        const wakesBefore = w.chat.wakes.length

        // The broker delivers both jobs again: the rows are completed, so nothing is locked, claimed or woken twice.
        w.queued.push(...jobs)
        await w.consume()

        expect(w.chat.wakes).toHaveLength(wakesBefore)
        expect(w.chat.wakes).toHaveLength(1)
        expect(w.results).toHaveLength(2)
    })
})

describe("bank credit proof world, R97: a customer line never declares a fact key", () => {
    it("(g) a customer sending the same words twice on Zalo is two lines and two events: no fact claim is asked", async () => {
        const db = threadDbOf()
        const process = await processOf(db)
        const { facts, claim } = factsOf([])
        Reflect.set(chatServicesOf(db).triggers, "facts", facts)

        const first = await customersSay(process, [{ text: "Shop mo cua may gio?", key: "m-same-1" }])
        const second = await customersSay(process, [{ text: "Shop mo cua may gio?", key: "m-same-2" }])

        expect(db.chat.lines.heard.map((line) => [line.text, line.key])).toEqual([
            ["Shop mo cua may gio?", "zalo:m-same-1"],
            ["Shop mo cua may gio?", "zalo:m-same-2"],
        ])
        expect([...first, ...second]).toHaveLength(2)
        expect(claim).not.toHaveBeenCalled()
    })
})
