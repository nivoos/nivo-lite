import { defineJob, type JobDefinition, type JobEffectDeclaration } from "@modules/platform/jobs"
import {
    ZALO_REFRESH_QUEUE,
    ZaloRefreshJob,
    isZaloRefreshConnectionPayload,
    isZaloRefreshPayload,
    zaloRefreshConnectionKey,
    type ZaloRefreshConnectionPayload,
    type ZaloRefreshPayload,
} from "./zalo-refresh.queue"

/**
 * The outside effect of spending a single-use refresh token: Zalo answers a new pair that no second call can make again. The pair is KEPT
 * (sealed) on the ledger row before it is stored, so a crash after the answer is finished by storing the kept pair. An act whose outcome
 * was lost is made again: if Zalo never saw it the token still works; if it did, Zalo refuses and the connection asks its owner to
 * reconnect, which is the typed end a person sees.
 */
export const ZALO_REFRESH_EFFECT: JobEffectDeclaration = { name: "zalo.refresh-tokens", settle: "repeatable" }

/** The tick: finds what is due and writes one renewal job per connection in one transaction. Nobody waits: `background`. */
export const REFRESH_ZALO_TOKENS_JOB: JobDefinition<ZaloRefreshPayload> = defineJob<ZaloRefreshPayload>({
    name: ZaloRefreshJob.Tick,
    queue: ZALO_REFRESH_QUEUE,
    ladder: "background",
    payload: isZaloRefreshPayload,
    onceKey: () => ZaloRefreshJob.Tick,
    next: [ZaloRefreshJob.Connection],
    effects: [],
})

/** The renewal of one connection's pair. Nobody waits: `background` (the owner's own use renews on demand). */
export const REFRESH_ZALO_CONNECTION_JOB: JobDefinition<ZaloRefreshConnectionPayload> = defineJob<ZaloRefreshConnectionPayload>({
    name: ZaloRefreshJob.Connection,
    queue: ZALO_REFRESH_QUEUE,
    ladder: "background",
    payload: isZaloRefreshConnectionPayload,
    onceKey: zaloRefreshConnectionKey,
    next: [],
    effects: [ZALO_REFRESH_EFFECT],
})
