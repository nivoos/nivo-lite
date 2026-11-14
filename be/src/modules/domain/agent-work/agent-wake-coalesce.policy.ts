import type { AgentWakeContext } from "./agent-work.contracts"

/*
 * RULE Q-4, the pure halves of the modes that combine (`each` combines nothing). `stream` (QB-P5 C-2): the un-run wakes of one (agent,
 * lock scope, declaration, registration) whose declaration combines as a `stream` are ONE marker, the OLDEST; every other is closed
 * `coalesced:<marker>` and counted on the marker. `latest` (QB-LATEST): the wake just written replaces every other un-run wake of its set,
 * each closed `replaced:<newest>`. The door (`AgentWakeService.coalesce` / `.replaceOlder`) reads the set under a lock and writes what this
 * decides; the worlds' wake table runs the same decisions.
 */

/** The reason a wake folded into a stream marker is closed with: `coalesced:<marker wake id>`. */
export const COALESCED_REASON = "coalesced:"

/** The combine mode of a wake context that makes it a stream member. */
export const STREAM_COMBINE = "stream"

/** One un-run wake of a combine set (`stream` or `latest`), as the door read it. */
export interface UnrunStreamWake {
    /** The wake id. */
    readonly id: string
    /** Its ids-only context. */
    readonly context: AgentWakeContext
    /** When it was written: the order of the set. */
    readonly createdAt: Date
}

/** What combining a stream set comes to: the marker, its new context, and the wakes to close behind it. */
export interface StreamCoalescing {
    /** The oldest wake of the set: the one that stays. */
    readonly markerId: string
    /** The marker's context with `count` and `latestEventId` of the whole set. */
    readonly context: AgentWakeContext
    /** Every other wake of the set, oldest first: each is closed `coalesced:<marker>`. */
    readonly closed: ReadonlyArray<string>
}

/** How many events a wake stands for: its own `count`, else 1 (itself). */
export const streamCountOf = (context: Pick<AgentWakeContext, "count">): number => {
    const count = Number(context.count)
    return Number.isInteger(count) && count >= 1 ? count : 1
}

/** True for a wake whose declaration combines as a `stream`. */
export const isStreamWake = (context: Pick<AgentWakeContext, "combine">): boolean => context.combine === STREAM_COMBINE

/**
 * The combining of an un-run stream set (any order), or null when there is nothing to fold (one wake or none). The marker is the oldest
 * (created first, then by id); it keeps its own event (`eventId`, the data a run reads, the hand-back key) and gains the sum of the counts
 * and the newest event folded in (`latestEventId`: the newest wake's own latest, else its event).
 */
export const streamCoalescingOf = (wakes: ReadonlyArray<UnrunStreamWake>): StreamCoalescing | null => {
    if (wakes.length < 2) return null
    const ordered = wakes.toSorted((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
    const [marker, ...rest] = ordered
    const newest = ordered.at(-1)
    if (marker === undefined || newest === undefined) return null
    const count = ordered.reduce((sum, wake) => sum + streamCountOf(wake.context), 0)
    const latestEventId = newest.context.latestEventId ?? newest.context.eventId
    return {
        markerId: marker.id,
        context: {
            ...marker.context,
            count: String(count),
            ...(latestEventId === undefined ? {} : { latestEventId }),
        },
        closed: rest.map((wake) => wake.id),
    }
}

/** The reason a wake replaced by a newer one of its `latest` set is closed with: `replaced:<the newer wake id>`. Never retried. */
export const REPLACED_REASON = "replaced:"

/** The combine mode of a wake context whose set keeps only the newest event. */
export const LATEST_COMBINE = "latest"

/** True for a wake whose declaration combines as `latest`. */
export const isLatestWake = (context: Pick<AgentWakeContext, "combine">): boolean => context.combine === LATEST_COMBINE

/** What replacing the older wakes of a `latest` set comes to: the wake that stays, its new context, and the wakes it closes. */
export interface LatestReplacing {
    /** The wake just written: the newest event, the one that stays. */
    readonly keptId: string
    /** Its context with `count` = the events it now stands for (itself + every wake it replaced). */
    readonly context: AgentWakeContext
    /** Every other wake of the set, oldest first: each is closed `replaced:<kept>`. */
    readonly closed: ReadonlyArray<string>
}

/**
 * RULE Q-4 `latest` (QB-LATEST, QUEUE-DESIGN C.3), the pure half: the wake JUST WRITTEN (`newestId`, named by the door: wakes of one delivery
 * share an instant, so times cannot tell) replaces every other un-run wake of its set; it keeps its own event and stands for the sum of the
 * counts. Null when it replaces nothing (a set of one) or when it is not in the set (it was begun or closed meanwhile: nothing to decide).
 */
export const latestReplacingOf = (wakes: ReadonlyArray<UnrunStreamWake>, newestId: string): LatestReplacing | null => {
    const kept = wakes.find((wake) => wake.id === newestId)
    if (kept === undefined) return null
    const older = wakes
        .filter((wake) => wake.id !== newestId)
        .toSorted((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
    if (older.length === 0) return null
    const count = streamCountOf(kept.context) + older.reduce((sum, wake) => sum + streamCountOf(wake.context), 0)
    return { keptId: kept.id, context: { ...kept.context, count: String(count) }, closed: older.map((wake) => wake.id) }
}

/** The clock-skew margin of the settle check in `agent_turn_begin` (its `window - 500`). */
const SETTLE_SKEW_MS = 500

/**
 * When a PENDING marker that settles may begin once a newer event folded into it (the settle window keeps sliding, ROAD-API section 5): now
 * + its window, but never later than its own creation + the longest wait (at least the window). Null when the marker settles not at all.
 */
export const settledNotBeforeOf = (
    marker: { readonly createdAt: Date; readonly burstWindowMs: number | null; readonly burstMaxMs: number | null },
    now: Date,
): Date | null => {
    const window = marker.burstWindowMs ?? 0
    if (window <= 0) return null
    const cap = marker.createdAt.getTime() + Math.max(marker.burstMaxMs ?? 0, window)
    // The newest event's own drain job runs after the window; the begin admits a wake half a second early (the begin's clock-skew margin).
    return new Date(Math.min(now.getTime() + Math.max(window - SETTLE_SKEW_MS, 0), cap))
}
