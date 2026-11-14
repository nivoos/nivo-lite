import type { ConnectionReadyPayload } from "@modules/events/api"
import { Injectable } from "@nestjs/common"
import { ConnectionsService, halvesOf, hostsOf, type ConnectionRecord } from "@modules/domain/connections"
import { PollReceiverRegistryService, type PollReceiver } from "@modules/domain/provider-registry"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { ConnectionPollRunService, emptyPollSummary } from "./connection-poll-run.service"
import { InjectConnectionPollOptions, InjectPollRandom, type PollRandom } from "./connection-poll.decorators"
import { ConnectionPollLogEvent } from "./connection-poll.log-events"
import { cursorOf } from "./connection-poll.policy"
import { ConnectionPollError, ConnectionPollErrorCode } from "./errors/connection-poll.error"
import { PollLimiterService } from "./poll-limiter.service"
import { PollOwnerNoticeService } from "./poll-owner-notice.service"
import {
    authReasonOf,
    interleavedByWorkspace,
    jittered,
    planAfterFailure,
    planAfterRead,
    probeOf,
    BUSY_PROVIDER_RECHECK_MS,
    type PollPlan,
} from "./poll-schedule.policy"
import type { PollFailure } from "./connection-poll.contracts"
import { PollScheduleService, type DueConnection } from "./poll-schedule.service"
import type { ConnectionPollOptions } from "./connection-poll.options"
import type { PolledAccount } from "./connection-poll.contracts"
import type { PollOutcome, PollWalkOptions } from "./poll-schedule.contracts"
import { PollReceiptsService } from "./poll-receipts.service"

/** What one tick did for one provider; the numbers the metrics log carries. */
export interface ProviderTally {
    /** Connections polled. */
    polled: number
    /** Rows the provider listed. */
    found: number
    /** Items stored that the webhook had not delivered. */
    missedByWebhook: number
    /** Answers that asked to slow down (429). */
    rateLimited: number
    /** Answers that refused the credential. */
    authFailed: number
    /** Failures to retry later. */
    transient: number
    /** Polls the provider's plan does not allow. */
    unavailable: number
    /** Failures to give up on. */
    fatal: number
    /** Polls that waited for the rate limit and were planned again, or found the provider busy. */
    deferred: number
    /** How far past its planned time the latest poll started, in milliseconds. */
    maxLagMs: number
}

const emptyTally = (): ProviderTally => ({
    polled: 0,
    found: 0,
    missedByWebhook: 0,
    rateLimited: 0,
    authFailed: 0,
    transient: 0,
    unavailable: 0,
    fatal: 0,
    deferred: 0,
    maxLagMs: 0,
})

/** Counts one failed poll under the kind it ended as. */
const countFailure = (tally: ProviderTally, kind: PollFailure["kind"]): void => {
    tally.rateLimited += kind === "rate_limited" ? 1 : 0
    tally.authFailed += kind === "auth_failed" ? 1 : 0
    tally.transient += kind === "transient" ? 1 : 0
    tally.unavailable += kind === "unavailable" ? 1 : 0
    tally.fatal += kind === "fatal" ? 1 : 0
}

@Injectable()
/**
 * One tick of the adaptive poll: gives every connection a schedule row, claims only the connections that are due (a batch, fair across workspaces),
 * polls each under the provider's rate limit and concurrency cap, and plans its next poll from how it ended: the adaptive interval with jitter, the
 * backoff of a 429 or a transient failure, the breaker, or the owner request of a refused credential. Nothing here names a provider.
 */
export class PollSchedulerService {
    private readonly run: ConnectionPollRunService

    constructor(
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
        @InjectPollRandom() private readonly random: PollRandom,
        @InjectConnectionPollOptions() private readonly options: ConnectionPollOptions,
        private readonly connections: ConnectionsService,
        private readonly schedule: PollScheduleService,
        private readonly receivers: PollReceiverRegistryService,
        private readonly receipts: PollReceiptsService,
        private readonly limiter: PollLimiterService,
        private readonly notice: PollOwnerNoticeService,
    ) {
        this.run = new ConnectionPollRunService({
            clock,
            logger,
            connections,
            beforeFetch: (connection) => this.takeToken(connection),
        })
    }

    /** Polls what is due now; answers what it did for each provider. */
    async tick(): Promise<ReadonlyMap<string, ProviderTally>> {
        const tallies = new Map<string, ProviderTally>()
        const providers = this.polledProviders()
        if (providers.length === 0) return tallies
        await this.schedule.enroll(providers)
        const due = await this.schedule.claimDue(providers, this.options.schedule.batchSize)
        const ordered = interleavedByWorkspace(due.map((item) => ({ ...item, workspaceId: item.row.workspaceId })))
        await eachInOrder(ordered, (item) => this.pollOne(item, tallies))
        tallies.forEach((tally, provider) => {
            this.logger.info(ConnectionPollLogEvent.Metrics, { provider, ...tally })
        })
        return tallies
    }

    /**
     * A connection became ready to be read back (its credential was saved): when its provider has a poll receiver (or may hold the half of
     * one), the account is made ready and hot, so the next tick reads back what reached the provider before it was connected. Answers
     * whether it was.
     */
    async ready(fact: Pick<ConnectionReadyPayload, "connectionId" | "provider">): Promise<boolean> {
        if (!this.polledProviders().includes(fact.provider)) return false
        await this.schedule.markReady(fact.connectionId)
        return true
    }

    /** The providers whose accounts are polled: every provider with a poll receiver and every provider whose accounts may hold its half. */
    private polledProviders(): ReadonlyArray<string> {
        return [...new Set(this.receivers.providers().flatMap((provider) => [provider, ...hostsOf(provider)]))]
    }

    /**
     * The poll receiver that reads an account (its declared facts: limits, classes, cadence, data type): its own provider's, else the one of a
     * half it holds (a mailbox account's inbound half). Undefined when none is registered.
     */
    private receiverOf(record: ConnectionRecord): { readonly provider: string; readonly facts: PollReceiver } | undefined {
        const provider = [record.provider, ...halvesOf(record)].find((one) => this.receivers.has(one))
        const facts = provider === undefined ? undefined : this.receivers.liveOf(provider)
        return provider === undefined || facts === undefined ? undefined : { provider, facts }
    }

    /** The account as the walk reads and keeps it: the receiver of the account (live or sandbox: THE ONE SWITCH) and the generic store. */
    private accountOf(provider: string, dataType: string): PolledAccount {
        return {
            read: (connection, window) => {
                const port = this.receivers.portFor({ provider, sandbox: connection.sandbox })
                if (port === undefined) throw new ConnectionPollError({ code: ConnectionPollErrorCode.ReceiverMissing, params: { provider } })
                return port.read(connection, window)
            },
            keep: (connection, rows) => this.receipts.keep(connection, dataType, rows),
        }
    }

    private async takeToken(connection: ConnectionRecord): Promise<void> {
        const receiver = this.receiverOf(connection)
        if (receiver !== undefined) await this.limiter.pass(receiver.provider, connection.id, receiver.facts.limits)
    }

    private async pollOne(item: DueConnection, tallies: Map<string, ProviderTally>): Promise<void> {
        const { row } = item
        const record = await this.connections.find(row.workspaceId, row.connectionId)
        const receiver = record === null ? undefined : this.receiverOf(record)
        if (receiver === undefined || record === null || record.status === "disconnected") {
            await this.defer(row.connectionId, this.options.schedule.healthyIntervalMs)
            return
        }
        const slot = await this.limiter.enter(receiver.provider, row.connectionId, receiver.facts.limits)
        const tally = tallies.get(row.provider) ?? emptyTally()
        tallies.set(row.provider, tally)
        if (slot === undefined) {
            tally.deferred += 1
            await this.defer(row.connectionId, BUSY_PROVIDER_RECHECK_MS)
            return
        }
        const now = this.clock.now().getTime()
        tally.polled += 1
        tally.maxLagMs = Math.max(tally.maxLagMs, now - item.dueAt.getTime())
        const outcome = await this.run
            .poll(this.accountOf(receiver.provider, receiver.facts.dataType), record, emptyPollSummary(), this.walkOf(item, record))
            .finally(() => slot.release())
        await this.settle(item, record, receiver.facts, outcome, tally)
    }

    /** The first poll of a connection is a backfill read in chunks, so it goes through the same limiter as every other poll and never in one burst. */
    private walkOf(item: DueConnection, record: ConnectionRecord): PollWalkOptions {
        const { backfillTo, backfillNewest } = item.row
        const maxPages = this.options.schedule.backfillChunkPages
        if (backfillTo !== null) {
            return { to: backfillTo, newest: backfillNewest ?? undefined, maxPages }
        }
        return cursorOf(record.meta) === undefined ? { maxPages } : {}
    }

    private async settle(
        item: DueConnection,
        record: ConnectionRecord,
        receiver: PollReceiver,
        outcome: PollOutcome,
        tally: ProviderTally,
    ): Promise<void> {
        const now = this.clock.now().getTime()
        const unit = this.random.next()
        const row = probeOf(item.row)
        if (outcome.kind !== "failed") {
            tally.found += outcome.kind === "skipped" ? 0 : outcome.fetched
            tally.missedByWebhook += outcome.kind === "skipped" ? 0 : outcome.recorded
            await this.schedule.settle(row.connectionId, planAfterRead(row, outcome, now, this.cadenceOf(receiver), unit))
            if (outcome.kind !== "skipped") await this.recoverConnection(record, row)
            return
        }
        if (outcome.cause instanceof ConnectionPollError && outcome.cause.code === ConnectionPollErrorCode.Deferred) {
            tally.deferred += 1
            const waitMs: unknown = outcome.cause.params.waitMs
            this.logger.info(ConnectionPollLogEvent.Deferred, {
                connectionId: row.connectionId,
                provider: row.provider,
            })
            await this.defer(row.connectionId, typeof waitMs === "number" ? waitMs : BUSY_PROVIDER_RECHECK_MS)
            return
        }
        const failure = receiver.classify(outcome.cause)
        countFailure(tally, failure.kind)
        const plan = planAfterFailure(row, failure, now, this.cadenceOf(receiver), unit)
        await this.schedule.settle(row.connectionId, plan)
        await this.report(record, failure, plan, now)
    }

    /**
     * A poll read the provider again: whatever the earlier failures told the owner is no longer true. A refused credential that works again
     * clears the error status, and a degraded mark clears; nothing happens for a connection that never failed.
     */
    private async recoverConnection(record: ConnectionRecord, row: ReturnType<typeof probeOf>): Promise<void> {
        if (row.needsReauth) await this.connections.markRecovered(record.id)
        if (row.needsReauth || row.breakerState !== "closed" || row.failures > 0) {
            await this.connections.markHealth(record.id, { state: "ok", reason: "", checkedAt: this.clock.now().toISOString() })
        }
    }

    private async report(record: ConnectionRecord, failure: PollFailure, plan: PollPlan, now: number): Promise<void> {
        if (plan.breakerState === "open") {
            this.logger.warn(ConnectionPollLogEvent.BreakerOpened, {
                connectionId: record.id,
                provider: record.provider,
                kind: failure.kind,
            })
            // The breaker is open for a reason that is not a refused credential: the connection is connected yet cannot be read. It says so
            // (a refused credential is the status error and the owner's work item below, never this mark).
            if (failure.kind !== "auth_failed") {
                await this.connections.markHealth(record.id, {
                    state: "degraded",
                    reason: "the provider cannot be read at the moment",
                    checkedAt: this.clock.now().toISOString(),
                })
            }
        }
        if (!plan.raiseOwnerNotice) return
        if (failure.kind === "unavailable") {
            this.logger.warn(ConnectionPollLogEvent.Unavailable, {
                connectionId: record.id,
                provider: record.provider,
                reason: failure.reason,
            })
            await this.notice.unavailable(record, failure.notice, now)
            return
        }
        this.logger.warn(ConnectionPollLogEvent.NeedsReauth, { connectionId: record.id, provider: record.provider })
        await this.notice.needsReauth(record, now, authReasonOf(failure))
    }

    /**
     * The schedule a receiver's account is planned with: the receiver's own cadence (owner R95: dense when the poll is the only live way,
     * sparse while a webhook beside it delivers) over the scheduler's hot pass, backoff and breaker.
     */
    private cadenceOf(receiver: PollReceiver): ConnectionPollOptions["schedule"] {
        return {
            ...this.options.schedule,
            silentIntervalMs: receiver.cadence.aloneMs,
            healthyIntervalMs: receiver.cadence.besideWebhookMs,
        }
    }

    private defer(connectionId: string, afterMs: number): Promise<void> {
        const at = this.clock.now().getTime() + jittered(afterMs, this.options.schedule.jitterRatio, this.random.next())
        return this.schedule.defer(connectionId, new Date(at))
    }
}
