import { Injectable } from "@nestjs/common"
import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { ConnectionRecord } from "@modules/domain/connections"
import {
    providerRefusal,
    withProof,
    type ProviderRegistryError,
    type TiktokCreator,
    type TiktokPublishPort,
    type TiktokPublishRequest,
    type TiktokPublishStarted,
    type TiktokPublishState,
    type TiktokPublishStatus,
} from "@modules/domain/provider-registry"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import {
    TIKTOK_CASE,
    TIKTOK_CREATOR_OPERATION,
    TIKTOK_PUBLISH_OPERATION,
    TIKTOK_SANDBOX_CREATOR,
    TIKTOK_SANDBOX_JOBS,
    TIKTOK_SANDBOX_POST_ID_PREFIX,
    TIKTOK_SANDBOX_REFUSALS,
    TIKTOK_STATUS_OPERATION,
    type TiktokSandboxJob,
} from "./tiktok-sandbox.catalogue"
import { tiktokNotConfigured, tiktokRateLimited, tiktokServerError, tiktokUnreachable } from "./tiktok-sandbox.failures"

/** State name: the posts the account started, by publish id. */
const POST = "post"

/** A started post as the account's state keeps it: its job, the public post ids once completed, and how many status reads walked the job. */
interface KeptPost {
    readonly job: TiktokSandboxJob
    readonly postIds: ReadonlyArray<string>
    readonly polls: number
}

/** The job a publish with no named case starts (the default case's). */
const DEFAULT_JOB: TiktokSandboxJob = TIKTOK_SANDBOX_JOBS[TIKTOK_CASE.accepted] ?? { words: ["PUBLISH_COMPLETE"], failReason: null, withId: true }

/** Where a post stands by TikTok's documented status words alone (the live adapter's own rule). */
const stateOf = (word: string): TiktokPublishState => {
    if (word === "PUBLISH_COMPLETE") return "published"
    return word === "FAILED" ? "failed" : "pending"
}

/** The refusal a refusing case throws, or null when the picked case refuses nothing. */
const refusalOf = (nextCase: string | null): ProviderRegistryError | null => {
    const refusal = nextCase === null ? undefined : TIKTOK_SANDBOX_REFUSALS[nextCase]
    return refusal === undefined ? null : withProof(providerRefusal(PROVIDER.tiktok, refusal.reason, refusal.detail), "not_sent")
}

@Injectable()
/**
 * TikTok's SANDBOX implementation of the destination port (`TiktokPublishPort`; owner rulings R56, R59, R60, R62): used when the TikTok
 * account is a sandbox account. It answers through the generic sandbox frame from the hardcoded `TIKTOK-<n>` catalogue and never reaches
 * a host. The account's NEXT CASE of each operation (`creator`, `publish`, `status`) picks the answer (sticky; the operation's default
 * while nothing is picked); the request's words pick nothing. `creator` is the fixed creator. `publish` refuses a privacy level the
 * creator does not list `rejected` first (what TikTok answers, whatever case is picked); a refusing case throws exactly the live refusal
 * (`providerRefusal` proving `not_sent`); a rate limit, a 5xx, a lost answer and a missing app client throw the live failures
 * (`tiktok-sandbox.failures.ts`: the same `TiktokError` through the live mapping). An accepted post keeps its job in state: the later
 * outcome arrives by the live poll, `status` walks the job's status words one per read and stays on the last (completed with the public
 * post id, completed with none yet, FAILED with TikTok's reason, or processing for ever). Publish ids run `sbx-tt-publish-<n>` by the
 * publishes the account took (`state.seq`). The sandbox adds no idempotency, and a file source is not read (no bytes to send).
 */
export class TiktokSandboxVideoService implements TiktokPublishPort {
    /** The provider key. */
    readonly provider: string = PROVIDER.tiktok

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** The fixed creator of a sandbox account through exactly one sandbox call. */
    async creator(connection: ConnectionRecord): Promise<TiktokCreator> {
        return await this.sandbox.call(connection, TIKTOK_CREATOR_OPERATION, {}, {
            answer: (state) => {
                const refusal = refusalOf(state.nextCase)
                if (refusal !== null) throw refusal
                if (state.nextCase === TIKTOK_CASE.creatorRateLimited) throw tiktokRateLimited()
                if (state.nextCase === TIKTOK_CASE.creatorTimeout) throw tiktokUnreachable()
                return TIKTOK_SANDBOX_CREATOR
            },
        })
    }

    /** Starts one post through exactly one sandbox call keyed by the title; the post is kept in state to be polled. */
    async publish(connection: ConnectionRecord, request: TiktokPublishRequest): Promise<TiktokPublishStarted> {
        return await this.sandbox.call(connection, TIKTOK_PUBLISH_OPERATION, request, {
            key: request.title ?? "",
            answer: async (state) => {
                if (!TIKTOK_SANDBOX_CREATOR.privacyLevelOptions.includes(request.privacyLevel)) {
                    const mismatch = TIKTOK_SANDBOX_REFUSALS[TIKTOK_CASE.privacyMismatch]
                    throw withProof(providerRefusal(PROVIDER.tiktok, mismatch?.reason ?? "rejected", mismatch?.detail ?? null), "not_sent")
                }
                const refusal = refusalOf(state.nextCase)
                if (refusal !== null) throw refusal
                if (state.nextCase === TIKTOK_CASE.notConfigured) throw tiktokNotConfigured()
                if (state.nextCase === TIKTOK_CASE.rateLimited) throw tiktokRateLimited()
                if (state.nextCase === TIKTOK_CASE.serverError) throw tiktokServerError()
                if (state.nextCase === TIKTOK_CASE.timeout) throw tiktokUnreachable()
                const job = (state.nextCase === null ? undefined : TIKTOK_SANDBOX_JOBS[state.nextCase]) ?? DEFAULT_JOB
                const number = String(state.seq + 1).padStart(6, "0")
                const publishId = `sbx-tt-publish-${number}`
                const kept: KeptPost = { job, postIds: job.withId ? [`${TIKTOK_SANDBOX_POST_ID_PREFIX}${number}`] : [], polls: 0 }
                await state.write(POST, publishId, kept)
                if (state.nextCase === TIKTOK_CASE.appliedNoAnswer) throw tiktokUnreachable()
                return { publishId }
            },
        })
    }

    /** The post as it stands through exactly one sandbox call keyed by the publish id; each read moves the job one status word on. */
    async status(connection: ConnectionRecord, publishId: string): Promise<TiktokPublishStatus> {
        return await this.sandbox.call(connection, TIKTOK_STATUS_OPERATION, { publishId }, {
            key: publishId,
            answer: async (state) => {
                const refusal = refusalOf(state.nextCase)
                if (refusal !== null) throw refusal
                if (state.nextCase === TIKTOK_CASE.statusRateLimited) throw tiktokRateLimited()
                if (state.nextCase === TIKTOK_CASE.statusTimeout) throw tiktokUnreachable()
                const value = await state.read(POST, publishId)
                if (value === null) throw withProof(providerRefusal(PROVIDER.tiktok, "not_found", "publish id not found"), "not_sent")
                const kept = value as KeptPost
                const word = kept.job.words[Math.min(kept.polls, kept.job.words.length - 1)] ?? "PROCESSING_UPLOAD"
                await state.write(POST, publishId, { ...kept, polls: kept.polls + 1 })
                const done = stateOf(word) === "published"
                return {
                    publishId,
                    state: stateOf(word),
                    providerStatus: word,
                    failReason: word === "FAILED" ? kept.job.failReason : null,
                    postIds: done ? kept.postIds : [],
                }
            },
        })
    }
}
