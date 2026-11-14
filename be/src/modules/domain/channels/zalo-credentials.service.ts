import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { parseZaloSecret } from "@modules/domain/channel-connections"
import { ConnectionSecretsService, randomSecret, safeEqual } from "@modules/domain/connection-secrets"
import { ConnectionSecretReadsService, ConnectionsService, sha256 } from "@modules/domain/connections"
import { ConnectionReadyEvent } from "@modules/events/api"
import { InjectZalo, isZaloRefusal, newVerifier, type ZaloClient } from "@modules/integrations/zalo"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectEffects, type EffectCallKept, type EffectResult, type Effects } from "@modules/platform/effects"
import { InjectEventBus, type EventBus } from "@modules/platform/event-bus"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder, ok, refused, type Outcome } from "@modules/platform/primitives"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import {
    COMPLETE_ZALO_AUTHORIZATION_JOB,
    ZALO_EXCHANGE_EFFECT,
    isZaloAuthorizationPayload,
    type ZaloAuthorizationPayload,
} from "@modules/queues/zalo-authorization"
import {
    REFRESH_ZALO_CONNECTION_JOB,
    ZALO_REFRESH_EFFECT,
    isZaloRefreshConnectionPayload,
    isZaloRefreshPayload,
    type ZaloRefreshConnectionPayload,
} from "@modules/queues/zalo-refresh"
import { InjectChannelsOptions } from "./channels.decorators"
import type {
    LoadedZalo,
    TokenWish,
    ZaloAuthorization,
    ZaloRefreshFanOut,
    ZaloReturn,
    ZaloSecret,
} from "./channels.contracts"
import { ChannelsLogEvent } from "./channels.log-events"
import type { ChannelsConfig } from "./channels.options"
import { ChannelsError, ChannelsErrorCode } from "./errors/channels.error"
import { ZALO_AUTHORIZATION_FAILED_REASON, ZALO_RECONNECT_REASON } from "./messages/channels.messages"
import { parseTokenPair, tokenPairOf, type ZaloTokenPair } from "./zalo-token-pair.policy"

/** An access token with less than this left is renewed before use. */
const SKEW_MS = 5 * 60_000
/** How long one refresh holds the lease; a crashed worker frees it by this time. */
const LEASE_MS = 30_000
/** The refresh token lives 3 months. */
const REFRESH_TTL_MS = 90 * 86_400_000
/** A started authorization is good for 15 minutes. */
const AUTHORIZATION_TTL_MS = 15 * 60_000
/** The address Zalo returns the owner to, relative to the web origin. */
const CALLBACK_PATH = "/connections/zalo/callback"
/** Seven hours: a token that ends within this time is renewed when the tick carries no horizon of its own. */
const DEFAULT_WITHIN_MS = 7 * 3_600_000
/** The digits of a digest that name a single-use input in an effect key or a dedupe key (the input itself never travels in a key). */
const DIGEST_DIGITS = 16

/** The part of an effect key that names the single-use token or code an act spends. */
const spentOf = (singleUse: string): string => sha256(singleUse).slice(0, DIGEST_DIGITS)

/** The connection id a state names: its text before the first dot. */
const connectionOf = (state: string): string => state.split(".")[0] ?? ""

/** The codes of a refused return that are the end of the authorization, not a failure of the job: the owner reads the connection and starts again. */
const AUTHORIZATION_ENDS: ReadonlySet<string> = new Set([
    ChannelsErrorCode.ZaloStateRejected,
    ChannelsErrorCode.ZaloStateExpired,
    ChannelsErrorCode.ConnectionNotFound,
])

/** True when a failure is the typed end of an authorization (a return the state or Zalo refused), as opposed to a failure of the work. */
const isAuthorizationEnd = (cause: unknown): boolean =>
    (cause instanceof ChannelsError && AUTHORIZATION_ENDS.has(cause.code)) || isZaloRefusal(cause)

/** What an exchange with Zalo answers. */
type ZaloAnswer = Parameters<typeof tokenPairOf>[0]

/** What storing an exchanged authorization needs. */
interface AuthorizationStore {
    /** The workspace of the connection. */
    readonly workspaceId: string
    /** The connection. */
    readonly connectionId: string
    /** The credential as it was read before the exchange. */
    readonly secret: ZaloSecret
    /** The pair Zalo handed over. */
    readonly pair: ZaloTokenPair
    /** The OA id Zalo reported, when it did. */
    readonly oaId: string | undefined
}

@Injectable()
/**
 * The Zalo OA credential: the sealed JSON of App ID, App secret, OA secret key and tokens. A refresh token and an authorization code each work
 * once, so each exchange is an outside effect whose answer (the new pair) is KEPT sealed on the effect ledger before it is stored: a crash
 * after Zalo answered is finished by storing the kept pair, never by a second call. A refresh also holds a short database lease; a second
 * caller finds the lease taken and either reads the winner's token or is told to try again shortly.
 */
export class ZaloCredentialsService {
    constructor(
        @InjectClock() private readonly clock: Clock,
        @InjectChannelsOptions() private readonly options: ChannelsConfig,
        @InjectZalo() private readonly zalo: ZaloClient,
        @InjectLogger() private readonly logger: Logger,
        private readonly secrets: ConnectionSecretsService,
        private readonly connections: ConnectionsService,
        private readonly secretReads: ConnectionSecretReadsService,
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectEventBus() private readonly bus: EventBus,
        @InjectEffects() private readonly effects: Effects,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
    ) {}

    /** The address to register on the Zalo app: Zalo sends the browser back here with code, oa_id and state. */
    callbackUrl(): string {
        return `${this.options.siteUrl}${CALLBACK_PATH}`
    }

    /** The credential of a connected Zalo connection, or a refusal when it is missing, disconnected or unreadable. */
    async load(connectionId: string): Promise<Outcome<LoadedZalo, ChannelsErrorCode>> {
        const found = await this.secretReads.secretOf(connectionId, "zalo_oa")
        if (found.kind !== "ok") return refused(ChannelsErrorCode.ConnectionNotFound)
        const secret = this.parse(found.value.credential)
        if (secret.kind !== "ok") return secret
        return ok({
            secret: secret.value,
            expiresAt: found.value.tokenExpiresAt === null ? null : Date.parse(found.value.tokenExpiresAt),
            workspaceId: found.value.workspaceId,
        })
    }

    /**
     * Starts an authorization: stores the PKCE verifier with a one-time nonce and answers the permission page. A verifier that is still
     * live is reused, so the same request run again (a redelivered wizard step) answers the same page instead of minting a second one.
     */
    async beginAuthorization(workspaceId: string, connectionId: string): Promise<ZaloAuthorization> {
        const loaded = await this.requireOf(workspaceId, connectionId)
        const now = this.clock.now().getTime()
        const live = loaded.secret.pkce !== undefined && loaded.secret.pkce.exp > now ? loaded.secret.pkce : undefined
        const pkce = live ?? { verifier: newVerifier(), nonce: randomSecret(), exp: now + AUTHORIZATION_TTL_MS }
        if (live === undefined) await this.save(connectionId, { ...loaded.secret, pkce })
        const callbackUrl = this.callbackUrl()
        return {
            url: this.zalo.authorizeUrl(
                loaded.secret.appId,
                callbackUrl,
                pkce.verifier,
                `${connectionId}.${pkce.nonce}`,
            ),
            callbackUrl,
        }
    }

    /**
     * Finishes an authorization: the state must match the started one, then the code is exchanged (an effect that keeps the answer sealed) and
     * the tokens are stored, the OA marked authorized and the connection announced ready in ONE transaction. A return whose tokens were
     * already stored (the connection holds tokens and no started authorization) is finished: nothing is exchanged twice. Answers the connection id.
     */
    async completeAuthorization(workspaceId: string, input: ZaloReturn): Promise<string> {
        const [connectionId = "", nonce = ""] = input.state.split(".")
        const loaded = await this.requireOf(workspaceId, connectionId)
        const pkce = loaded.secret.pkce
        if (pkce === undefined) {
            if (loaded.secret.accessToken !== undefined) return connectionId
            throw new ChannelsError({ code: ChannelsErrorCode.ZaloStateRejected })
        }
        if (!safeEqual(pkce.nonce, nonce)) throw new ChannelsError({ code: ChannelsErrorCode.ZaloStateRejected })
        const pair = await this.effects.once(
            `zalo.exchange:${connectionId}:${spentOf(input.code)}`,
            ZALO_EXCHANGE_EFFECT,
            this.pairCall(() => {
                // An answer already kept is stored whatever the clock says; only a NEW exchange needs a live authorization.
                if (this.clock.now().getTime() > pkce.exp) {
                    throw new ChannelsError({ code: ChannelsErrorCode.ZaloStateExpired })
                }
                return this.zalo.exchangeCode(loaded.secret.appId, loaded.secret.appSecret, input.code, pkce.verifier)
            }),
        )
        await this.storeAuthorization({ workspaceId, connectionId, secret: loaded.secret, pair, oaId: input.oaId })
        return connectionId
    }

    /**
     * Completes the authorization a queued job carries. The one-time code cannot be tried twice, so a state or a code that is refused is the END
     * of the authorization: the connection is marked failing for the owner to see and the job returns. Any other failure is thrown for the
     * runner (its ladder, then one dead letter).
     */
    async completeFromJob(payload: unknown): Promise<void> {
        const { workspaceId, state, code, oaId } = this.authorizationOf(payload)
        try {
            await this.completeAuthorization(workspaceId, { state, code, ...(oaId === null ? {} : { oaId }) })
        } catch (cause) {
            if (!isAuthorizationEnd(cause)) throw cause
            this.logger.error(ChannelsLogEvent.ZaloAuthorizationRefused, cause, { connectionId: connectionOf(state) })
            await this.connections.markFailing(connectionOf(state), ZALO_AUTHORIZATION_FAILED_REASON)
        }
    }

    /** The authorization job went to its dead letter: the connection its state names reads failing, and a resume completes it again. */
    async authorizationFailed(payload: unknown): Promise<void> {
        await this.connections.markFailing(connectionOf(this.authorizationOf(payload).state), ZALO_AUTHORIZATION_FAILED_REASON)
    }

    /**
     * The refresh tick: writes ONE renewal job per Zalo connection whose access token ends within the tick's horizon (its own, else seven
     * hours), all in one transaction, so each connection has its own ladder and dead letter. The once key names the connection and the
     * token end that made it due: a connection already renewed has a new end, and one that is parked is not queued twice.
     */
    fanOutFromJob(payload: unknown): Promise<ZaloRefreshFanOut> {
        return this.fanOutDue(isZaloRefreshPayload(payload) ? payload.withinMs : DEFAULT_WITHIN_MS)
    }

    /** Writes the renewal job of every Zalo connection whose access token ends within `withinMs`. */
    async fanOutDue(withinMs: number): Promise<ZaloRefreshFanOut> {
        const due = await this.secretReads.dueZalo(new Date(this.clock.now().getTime() + withinMs))
        if (due.length === 0) return { queued: 0 }
        await this.entityManager.transaction((tx) =>
            eachInOrder(due, (entry) => {
                const payload: ZaloRefreshConnectionPayload = {
                    workspaceId: entry.workspaceId,
                    connectionId: entry.id,
                    expiresAt: entry.expiresAt,
                }
                return this.outbox.write(tx, REFRESH_ZALO_CONNECTION_JOB.queue, payload, {
                    job: REFRESH_ZALO_CONNECTION_JOB.name,
                    dedupeKey: REFRESH_ZALO_CONNECTION_JOB.onceKey(payload),
                })
            }),
        )
        return { queued: due.length }
    }

    /**
     * Renews one connection's pair for the job that carries it. A connection that is gone, or whose token end is no longer the one that made
     * it due (renewed on use, or by an earlier run of this job), has nothing to renew: the job returns. Everything else is thrown for the runner.
     */
    async renewFromJob(payload: unknown): Promise<void> {
        if (!isZaloRefreshConnectionPayload(payload)) {
            throw new ChannelsError({ code: ChannelsErrorCode.PayloadInvalid, params: { job: REFRESH_ZALO_CONNECTION_JOB.name } })
        }
        const current = await this.load(payload.connectionId)
        if (current.kind !== "ok") {
            if (current.code === ChannelsErrorCode.ConnectionNotFound) return
            throw new ChannelsError({ code: current.code })
        }
        if (current.value.expiresAt !== payload.expiresAt) return
        await this.accessToken(payload.connectionId, { force: true })
    }

    /** A working access token: the stored one while it has more than 5 minutes left, else renewed on use. */
    async accessToken(connectionId: string, wish: TokenWish = {}): Promise<string> {
        const current = await this.require(connectionId)
        const fresh = this.freshToken(current, wish)
        if (fresh !== undefined) return fresh
        if (current.secret.renewalToken === undefined)
            throw new ChannelsError({ code: ChannelsErrorCode.ZaloNotAuthorized })
        const now = this.clock.now()
        if (!(await this.secrets.takeLease(connectionId, new Date(now.getTime() + LEASE_MS), now))) {
            return this.afterLostLease(connectionId, wish)
        }
        return this.refreshUnderLease(connectionId, wish).catch(async (cause: unknown) => {
            await this.secrets.releaseLease(connectionId)
            throw cause
        })
    }

    private async save(
        connectionId: string,
        secret: ZaloSecret,
        options: { readonly expiresAt?: Date } = {},
    ): Promise<void> {
        await this.secrets.save(connectionId, this.secrets.seal(JSON.stringify(secret)), options.expiresAt)
    }

    /** Stores the exchanged pair, marks the OA authorized and announces the connection ready: all or nothing. */
    private async storeAuthorization(done: AuthorizationStore): Promise<void> {
        const { workspaceId, connectionId, secret, pair, oaId } = done
        const sealed = this.secrets.seal(JSON.stringify(this.withTokens(secret, pair.accessToken, pair.renewalToken)))
        // The same token saved again is the same fact: its digest keys the ready event.
        const dedupeKey = `${connectionId}:zalo_token:${sha256(pair.accessToken).slice(0, DIGEST_DIGITS)}`
        const event = ConnectionReadyEvent.create({ workspaceId, connectionId, provider: "zalo_oa", dedupeKey })
        await this.entityManager.transaction(async (tx) => {
            await this.secrets.save(connectionId, sealed, new Date(pair.expiresAt), tx)
            await this.connections.applyZaloAuthorization(connectionId, oaId, tx)
            await this.bus.publish(event, tx, dedupeKey)
        })
    }

    private async refreshUnderLease(connectionId: string, wish: TokenWish): Promise<string> {
        // Another caller may have renewed between the first read and the lease: read again before spending the refresh token.
        const again = await this.require(connectionId)
        const fresh = this.freshToken(again, wish)
        if (fresh !== undefined) {
            await this.secrets.releaseLease(connectionId)
            return fresh
        }
        const renewalToken = again.secret.renewalToken
        if (renewalToken === undefined) throw new ChannelsError({ code: ChannelsErrorCode.ZaloNotAuthorized })
        // The refresh token works once: the answer is kept sealed on the ledger (keyed by the token it spends) BEFORE it is stored.
        const pair = await this.effects
            .once(
                `zalo.refresh:${connectionId}:${spentOf(renewalToken)}`,
                ZALO_REFRESH_EFFECT,
                this.pairCall(() => this.zalo.refreshTokens(again.secret.appId, again.secret.appSecret, renewalToken)),
            )
            .catch(async (cause: unknown) => {
                // Zalo answered and said no: the refresh token is used up, expired or revoked. Only a new authorization fixes that.
                if (isZaloRefusal(cause)) await this.connections.markFailing(connectionId, ZALO_RECONNECT_REASON)
                throw cause
            })
        await this.save(connectionId, this.withTokens(again.secret, pair.accessToken, pair.renewalToken), {
            expiresAt: new Date(pair.expiresAt),
        })
        return pair.accessToken
    }

    /** An exchange with Zalo whose answer, a token pair, is a SECRET the effect ledger keeps sealed and rebuilds. */
    private pairCall(act: () => Promise<ZaloAnswer>): EffectCallKept<ZaloTokenPair> {
        return {
            act: async () => tokenPairOf(await act(), this.clock.now().getTime()),
            keep: (pair) => ({ accessToken: pair.accessToken, renewalToken: pair.renewalToken, expiresAt: pair.expiresAt }),
            from: (kept) => this.keptPair(kept),
            secret: true,
        }
    }

    private keptPair(kept: EffectResult): ZaloTokenPair {
        const pair = parseTokenPair(JSON.stringify(kept))
        if (pair === null) throw new ChannelsError({ code: ChannelsErrorCode.ZaloKeptPairUnreadable })
        return pair
    }

    private async afterLostLease(connectionId: string, wish: TokenWish): Promise<string> {
        const settled = await this.require(connectionId)
        const fresh = wish.force === true ? undefined : this.freshToken(settled, wish)
        if (fresh === undefined) throw new ChannelsError({ code: ChannelsErrorCode.ZaloRefreshBusy })
        return fresh
    }

    private freshToken(loaded: LoadedZalo, wish: TokenWish): string | undefined {
        const token = loaded.secret.accessToken
        const alive = loaded.expiresAt !== null && loaded.expiresAt - this.clock.now().getTime() > SKEW_MS
        if (token === undefined || !alive || wish.force === true) return undefined
        return wish.stale !== undefined && safeEqual(token, wish.stale) ? undefined : token
    }

    private withTokens(secret: ZaloSecret, accessToken: string, renewalToken: string): ZaloSecret {
        const { pkce: _started, ...rest } = secret
        return {
            ...rest,
            accessToken,
            renewalToken,
            refreshExpiresAt: new Date(this.clock.now().getTime() + REFRESH_TTL_MS).toISOString(),
        }
    }

    private authorizationOf(payload: unknown): ZaloAuthorizationPayload {
        if (!isZaloAuthorizationPayload(payload)) {
            throw new ChannelsError({
                code: ChannelsErrorCode.PayloadInvalid,
                params: { job: COMPLETE_ZALO_AUTHORIZATION_JOB.name },
            })
        }
        return payload
    }

    private async require(connectionId: string): Promise<LoadedZalo> {
        const loaded = await this.load(connectionId)
        if (loaded.kind !== "ok") throw new ChannelsError({ code: loaded.code })
        return loaded.value
    }

    private async requireOf(workspaceId: string, connectionId: string): Promise<LoadedZalo> {
        const loaded = await this.require(connectionId)
        if (loaded.workspaceId !== workspaceId) throw new ChannelsError({ code: ChannelsErrorCode.ConnectionNotFound })
        return loaded
    }

    private parse(credential: string): Outcome<ZaloSecret, ChannelsErrorCode> {
        const secret = parseZaloSecret(credential)
        // A wizard secret that has no OA secret key yet cannot sign or verify anything: it is not a usable credential.
        if (secret === null || secret.oaSecret === "") return refused(ChannelsErrorCode.SecretUnreadable)
        return ok(secret)
    }
}
