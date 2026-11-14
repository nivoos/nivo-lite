import { defineJob, type JobDefinition, type JobEffectDeclaration } from "@modules/platform/jobs"
import {
    ZALO_AUTHORIZATION_JOB,
    ZALO_AUTHORIZATION_QUEUE,
    isZaloAuthorizationPayload,
    zaloAuthorizationKey,
    type ZaloAuthorizationPayload,
} from "./zalo-authorization.queue"

/**
 * The outside effect of exchanging the one-time authorization code: Zalo answers a token pair that no second call can make again. The pair
 * is KEPT (sealed) on the ledger row before it is stored. An act whose outcome was lost is made again: a code Zalo never saw still works, a
 * code it did see is refused, which is the typed end the owner sees on the connection.
 */
export const ZALO_EXCHANGE_EFFECT: JobEffectDeclaration = { name: "zalo.exchange-code", settle: "repeatable" }

/**
 * The completion of a Zalo authorization the browser returned with. The owner waits on the page that returned (`waited`). The producer is
 * the `zalo_authorization_return` database function (its dedupe key is `onceKey`); the job stores the pair, marks the OA authorized and
 * announces the connection ready in ONE transaction, so no crash leaves half of it.
 */
export const COMPLETE_ZALO_AUTHORIZATION_JOB: JobDefinition<ZaloAuthorizationPayload> = defineJob<ZaloAuthorizationPayload>({
    name: ZALO_AUTHORIZATION_JOB,
    queue: ZALO_AUTHORIZATION_QUEUE,
    ladder: "waited",
    payload: isZaloAuthorizationPayload,
    onceKey: zaloAuthorizationKey,
    next: [],
    effects: [ZALO_EXCHANGE_EFFECT],
})
