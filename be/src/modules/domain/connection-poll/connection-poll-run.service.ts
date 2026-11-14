import type { ConnectionRecord } from "@modules/domain/connections"
import type { PolledRow } from "@modules/domain/provider-registry"
import { failureFieldsOf } from "./poll-failure-fields.policy"
import { ConnectionPollLogEvent } from "./connection-poll.log-events"
import type { PollOutcome, PollWalkOptions } from "./poll-schedule.contracts"
import type { ConnectionPollDeps, PolledAccount, PollPage, PollSkipReason, PollSummary } from "./connection-poll.contracts"
import {
    POLL_MAX_PAGES,
    POLL_PAGE_SIZE,
    cursorOf,
    laterOf,
    metaWithCursor,
    olderPageEnd,
    windowStartOf,
} from "./connection-poll.policy"

/** What one account's walk over its pages read. */
interface Walk {
    /** The newest instant read so far. */
    readonly newest: Date | undefined
    /** Every row read, in page order (newest page first). */
    readonly rows: ReadonlyArray<PolledRow>
    /** Rows the provider listed. */
    readonly fetched: number
    /** Why the account was left out, when it was. */
    readonly skipped: PollSkipReason | undefined
    /** The end of the next older page when a chunk stopped before the walk was done; undefined when the walk finished. */
    readonly resumeTo: Date | undefined
}

/** Where a walk reads: the window start, the end of the page it begins at and the most pages of this call (undefined: the default cap). */
interface WalkRange {
    readonly from: Date
    readonly to: Date | undefined
    readonly pageLimit: number | undefined
}

/** A summary with nothing counted yet. */
export const emptyPollSummary = (): PollSummary => ({ connections: 0, fetched: 0, recorded: 0, skipped: 0, failed: 0 })

/**
 * THE WALK OF ONE ACCOUNT by its provider's POLL RECEIVER (owner R95): it reads the receiver's pages since the last instant it saw (the first
 * run reads a bounded window back), newest page first, then hands EVERY row of the walk to the account's keep (the engine's generic store:
 * the one intake, in the provider's time order, a new row admitted, an existing one nothing), counts the rows no other way had delivered,
 * and moves the cursor only when the whole walk was read and kept. A failed read is logged, counted and ANSWERED as the typed outcome
 * `failed` (with its cause), never thrown: the scheduler plans the next poll from it (backoff, breaker, owner request). The run waits for
 * nothing: the pace of the calls is the receiver's declared limit, taken by the caller before each read (`beforeFetch`).
 */
export class ConnectionPollRunService {
    constructor(private readonly deps: ConnectionPollDeps) {}

    /**
     * Polls one account and adds what it did to the summary. Answers how it ended, so the scheduler can plan the next poll: `options` starts
     * the walk at a page end carried over from a chunk and caps the pages of this call (a chunked backfill).
     */
    async poll(account: PolledAccount, record: ConnectionRecord, summary: PollSummary, options: PollWalkOptions = {}): Promise<PollOutcome> {
        summary.connections += 1
        try {
            return await this.pollWith(account, record, summary, options)
        } catch (cause) {
            summary.failed += 1
            this.deps.logger.error(ConnectionPollLogEvent.Failed, cause, {
                connectionId: record.id,
                provider: record.provider,
                ...failureFieldsOf(cause),
            })
            return { kind: "failed", cause }
        }
    }

    private async pollWith(
        account: PolledAccount,
        record: ConnectionRecord,
        summary: PollSummary,
        options: PollWalkOptions,
    ): Promise<PollOutcome> {
        if (record.environment === "test") return this.skip(record, "test_environment", summary)
        const cursor = cursorOf(record.meta)
        const from = windowStartOf(cursor, this.deps.clock.now())
        const start: Walk = { newest: laterOf(cursor, options.newest), rows: [], fetched: 0, skipped: undefined, resumeTo: undefined }
        const walk = await this.walk(account, record, { from, to: options.to, pageLimit: options.maxPages }, 0, start)
        summary.fetched += walk.fetched
        if (walk.skipped !== undefined) return this.skip(record, walk.skipped, summary)
        const recorded = await account.keep(record, walk.rows)
        summary.recorded += recorded
        if (recorded > 0) {
            this.deps.logger.warn(ConnectionPollLogEvent.MissedByWebhook, {
                connectionId: record.id,
                provider: record.provider,
                missed: recorded,
            })
        }
        if (walk.resumeTo !== undefined) {
            return { kind: "partial", fetched: walk.fetched, recorded, resumeTo: walk.resumeTo, newest: walk.newest }
        }
        if (walk.newest !== undefined && walk.newest.getTime() !== cursor?.getTime()) {
            await this.saveCursor(record, walk.newest)
        }
        return { kind: "done", fetched: walk.fetched, recorded }
    }

    /** Reads the pages from the newest back, collecting their rows; stops at a page that is not full. */
    private async walk(account: PolledAccount, record: ConnectionRecord, range: WalkRange, pageIndex: number, before: Walk): Promise<Walk> {
        const { from, to, pageLimit } = range
        if (pageIndex >= (pageLimit ?? POLL_MAX_PAGES)) {
            return pageLimit !== undefined && to !== undefined ? { ...before, resumeTo: to } : before
        }
        await this.deps.beforeFetch?.(record)
        const page: PollPage<PolledRow> = await account.read(record, { from, to, limit: POLL_PAGE_SIZE })
        if (page.kind === "skipped") return { ...before, skipped: page.reason }
        const after: Walk = {
            ...before,
            newest: laterOf(before.newest, page.newestAt),
            rows: [...before.rows, ...page.items],
            fetched: before.fetched + page.fetched,
        }
        const older = olderPageEnd(page, POLL_PAGE_SIZE, to)
        return older === undefined ? after : this.walk(account, record, { ...range, to: older }, pageIndex + 1, after)
    }

    private async saveCursor(record: ConnectionRecord, seenAt: Date): Promise<void> {
        const { connections } = this.deps
        const fresh = await connections.get(record.workspaceId, record.id)
        await connections.patch(record.workspaceId, record.id, { meta: metaWithCursor(fresh.meta, seenAt) })
    }

    private skip(record: ConnectionRecord, reason: PollSkipReason, summary: PollSummary): PollOutcome {
        summary.skipped += 1
        this.deps.logger.info(ConnectionPollLogEvent.Skipped, {
            connectionId: record.id,
            provider: record.provider,
            reason,
        })
        return { kind: "skipped", reason }
    }
}
