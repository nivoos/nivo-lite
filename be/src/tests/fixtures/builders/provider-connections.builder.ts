import { Test } from "@nestjs/testing"
import type { EntityManager } from "typeorm"
import { mock, recordingQueueOutbox as kitOutbox, type MockOf } from "@starci/jest-preset"
import { EFFECTS, type Effects, type EffectResult } from "@modules/platform/effects"
import {
    JOB_CLAIMS,
    JobDeadLettersService,
    JobRenewalService,
    JobRunnerService,
    JobStateEventsService,
    type ClaimedJob,
    type FencedProcessor,
    type JobClaims,
    type JobEffectDeclaration,
} from "@modules/platform/jobs"
import { JOBS_OPTIONS } from "@modules/platform/jobs/jobs.decorators"
import { eachInOrder } from "@modules/platform/primitives"
import { LOGGER, type Logger } from "@modules/platform/logging"
import {
    QUEUE_OUTBOX,
    QUEUE_WORKER_REGISTRY,
    QueueError,
    QueueErrorCode,
    type QueueDelivery,
    type QueueOutbox,
    type QueueWorkerRegistry,
} from "@modules/platform/queue"

/** The id of the job row every spec of a provider-connection chain runs under. */
export const CONNECTION_JOB_ID = "job-1"

/** What the effect ledger holds of one key. */
export interface KeptRow {
    /** The state: `intent` until the act's outcome is settled. */
    state: "intent" | "done"
    /** How many times the act was made under the key. */
    acts: number
    /** What the call kept of the answer, when it keeps one. */
    result?: EffectResult | undefined
}

/** The error an act throws when its worker is gone before the outcome is known (the network said nothing more). */
export const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

/** A call of the effects port as the double reads it: the act, and what is kept of its answer and rebuilt from it. */
interface LedgerCall<T> {
    /** The act outside the database. */
    readonly act: () => Promise<T>
    /** What of the answer is kept on the row. */
    readonly keep?: (answer: T) => EffectResult
    /** Rebuilds the answer from the kept result. */
    readonly from?: (kept: EffectResult) => T
    /** True when the kept value is a secret: the real ledger seals it, this double keeps a `sealed:` text instead of the value. */
    readonly secret?: true
}

/** The stand-in for the real sealing of a kept secret. */
const SEALED_PREFIX = "sealed:"

/** What the row keeps of a value: the value, or for a secret call its sealed text. */
const sealedOf = <T>(call: LedgerCall<T>, value: EffectResult): EffectResult =>
    call.secret === true ? `${SEALED_PREFIX}${JSON.stringify(value)}` : value

/** The value a row kept, opened when the call is a secret one. */
const openedOf = <T>(call: LedgerCall<T>, kept: EffectResult): EffectResult =>
    call.secret === true && typeof kept === "string" ? (JSON.parse(kept.slice(SEALED_PREFIX.length)) as EffectResult) : kept

/** The effects port as an in-memory ledger a spec reads and breaks. */
export interface KeptEffects {
    /** The port the service under test is given. */
    readonly effects: Effects
    /** The rows by key. */
    readonly rows: Map<string, KeptRow>
    /** The keys the ledger holds, in the order they were first keyed. */
    keys(): ReadonlyArray<string>
    /** The next act under this key throws this error before it is made. */
    failNext(key: string, error?: Error): void
    /** The next act under this key is made and its outcome is lost. */
    lostAfterAct(key: string): void
}

/**
 * The effects port as an in-memory ledger with the semantics of the real piece: an intent before the act; a key settled with a kept result
 * answers it WITHOUT acting; an act that throws releases its intent; a `repeatable` effect found as an intent (the process died after the
 * act) acts again. `failNext(key)` makes the next act throw before it happens (the worker dies before the call); `lostAfterAct(key)` lets the
 * act happen and then loses its outcome (the worker dies after the answer, before it is settled): the intent stays.
 */
export const keptEffects = (): KeptEffects => {
    const rows = new Map<string, KeptRow>()
    const failures = new Map<string, Error>()
    const lost = new Set<string>()
    const once = async <T>(key: string, effect: JobEffectDeclaration, call: LedgerCall<T>): Promise<T | undefined> => {
        const row = rows.get(key)
        if (row?.state === "done") {
            if (call.from !== undefined && row.result !== undefined) return call.from(openedOf(call, row.result))
            if (call.from === undefined && effect.settle !== "repeatable") return undefined
        }
        const mine: KeptRow = row ?? { state: "intent", acts: 0 }
        mine.state = "intent"
        rows.set(key, mine)
        const failure = failures.get(key)
        if (failure !== undefined) {
            failures.delete(key)
            rows.delete(key)
            throw failure
        }
        const answer = await call.act().catch((cause: unknown) => {
            rows.delete(key)
            throw cause
        })
        mine.acts += 1
        if (lost.delete(key)) throw killed()
        mine.state = "done"
        mine.result = call.keep === undefined ? undefined : sealedOf(call, call.keep(answer))
        return call.keep === undefined ? undefined : answer
    }
    // The port is overloaded (a call that keeps its answer, and one that does not); the double answers both with one body.
    const effects = { once, settleIn: (): Promise<void> => Promise.resolve() } as unknown as Effects
    return {
        effects,
        rows,
        keys: (): ReadonlyArray<string> => [...rows.keys()],
        failNext: (key: string, error: Error = killed()): void => {
            failures.set(key, error)
        },
        lostAfterAct: (key: string): void => {
            lost.add(key)
        },
    }
}

/** One job the outbox was asked to write. */
export interface WrittenJob {
    /** The queue. */
    readonly queue: string
    /** The payload. */
    readonly payload: object
    /** The job name. */
    readonly job: string | undefined
    /** The dedupe key. */
    readonly dedupeKey: string | undefined
    /** The transaction the write rode in. */
    readonly tx: EntityManager
}

/** An outbox double that remembers what was written. */
export interface RecordingOutbox {
    /** The port the service under test is given. */
    readonly outbox: MockOf<QueueOutbox>
    /** The jobs written; a repeated dedupe key is one job (as the database function treats it). */
    readonly written: Array<WrittenJob>
    /** True when something was written and every write went through a transaction. */
    inTransaction(): boolean
}

/** An outbox double that remembers what was written, and treats a repeated dedupe key as one job (as the database function does). */
export const recordingOutbox = (): RecordingOutbox => {
    const written: Array<WrittenJob> = []
    const kit = kitOutbox()
    const outbox = mock<QueueOutbox>()
    outbox.write.mockImplementation(async (tx, queue, payload, options) => {
        await kit.write(tx, queue, payload)
        if (options?.dedupeKey === undefined || !written.some((entry) => entry.dedupeKey === options.dedupeKey)) {
            written.push({ queue, payload, job: options?.job, dedupeKey: options?.dedupeKey, tx })
        }
    })
    return { outbox, written, inTransaction: (): boolean => kit.allInTransaction }
}

/** A provider of a Nest testing module. */
interface TokenProvider {
    /** The injection token. */
    readonly provide: symbol
    /** The double. */
    readonly useValue: unknown
}

/** The providers an effects-and-outbox consumer needs. */
export const effectProviders = (ledger: KeptEffects, outbox: QueueOutbox): ReadonlyArray<TokenProvider> => [
    { provide: EFFECTS, useValue: ledger.effects },
    { provide: QUEUE_OUTBOX, useValue: outbox },
]

/** One delivery of a job as the queue hands it to the runner. */
export const deliveryOf = (queue: string, job: string, payload: object, attempt: number): QueueDelivery => ({
    id: "d-1",
    queue,
    job,
    payload,
    attempt,
    signal: new AbortController().signal,
})

/** The runner of fenced jobs over a claims double, with what a spec reads of it. */
export interface RunnerHarness {
    /** The real runner: the real classifier, the real ladders, the real dead-letter path. */
    readonly runner: JobRunnerService
    /** The claims double. */
    readonly claims: MockOf<JobClaims>
    /** The dead-letter target: one `raise` per park. */
    readonly deadLetters: MockOf<JobDeadLettersService>
    /** Makes the next claim answer a job carrying this payload. */
    claimed(payload: object): void
}

/** The runner of fenced jobs over a claims double: the real classifier, the real ladders, the real dead-letter path. */
export const buildRunner = async (resumeCount = 0): Promise<RunnerHarness> => {
    const claims = mock<JobClaims>()
    const claimedJob = (payload: object): ClaimedJob => ({
        jobId: CONNECTION_JOB_ID,
        kind: "x",
        fencingToken: 1,
        currentStep: null,
        payload,
        ...(resumeCount > 0 ? { resumeCount } : {}),
    })
    claims.park.mockResolvedValue(true)
    claims.fail.mockResolvedValue(undefined)
    claims.release.mockResolvedValue(undefined)
    claims.complete.mockResolvedValue(undefined)
    claims.retryAfterSeconds.mockResolvedValue(null)
    const deadLetters = mock<JobDeadLettersService>()
    deadLetters.raise.mockResolvedValue(undefined)
    const states = mock<JobStateEventsService>()
    states.changed.mockResolvedValue(undefined)
    const renewals = mock<JobRenewalService>()
    renewals.keep.mockReturnValue({ stop: (): void => undefined })
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobRunnerService,
            {
                provide: JOBS_OPTIONS,
                useValue: { connection: "primary", workerId: "w-1", leaseMs: 60_000, scheduler: { enabled: false }, buildId: "b1" },
            },
            { provide: JOB_CLAIMS, useValue: claims },
            { provide: QUEUE_WORKER_REGISTRY, useValue: mock<QueueWorkerRegistry>() },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: JobRenewalService, useValue: renewals },
            { provide: JobDeadLettersService, useValue: deadLetters },
            { provide: JobStateEventsService, useValue: states },
        ],
    }).compile()
    return {
        runner: moduleRef.get(JobRunnerService),
        claims,
        deadLetters,
        claimed: (payload: object): void => {
            claims.claim.mockResolvedValue(claimedJob(payload))
        },
    }
}

/** What the network says when nothing answers: the platform classifier calls it transient. */
export const networkDown = (): Error => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" })

/** Runs a delivery on every start of a ladder and answers what each start threw: the queue's retry hint (seconds), or `returned` when the run ended without throwing (done or parked). */
export const startsOf = async (
    runner: JobRunnerService,
    processor: FencedProcessor,
    delivery: (attempt: number) => QueueDelivery,
    starts: number,
): Promise<ReadonlyArray<number | "returned">> => {
    const seen: Array<number | "returned"> = []
    let ended = false
    await eachInOrder(Array.from({ length: starts }, (_unused, index) => index + 1), async (attempt) => {
        if (ended) return
        try {
            await runner.run(processor, delivery(attempt))
            seen.push("returned")
            ended = true
        } catch (cause) {
            const seconds = cause instanceof QueueError && cause.code === QueueErrorCode.RetryAfter ? cause.params.seconds : undefined
            if (typeof seconds !== "number") throw cause
            seen.push(seconds)
        }
    })
    return seen
}
