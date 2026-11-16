import { Injectable } from "@nestjs/common"
import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { ConnectionRecord } from "@modules/domain/connections"
import {
    providerRefusal,
    withProof,
    type ProviderRegistryError,
    type YoutubePublishPort,
    type YoutubeVideo,
    type YoutubeVideoRequest,
    type YoutubeVideoState,
} from "@modules/domain/provider-registry"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import {
    YOUTUBE_CASE,
    YOUTUBE_PUBLISH_OPERATION,
    YOUTUBE_SANDBOX_DEFAULT_JOB,
    YOUTUBE_SANDBOX_JOBS,
    YOUTUBE_SANDBOX_PLAYLIST_FAILURE,
    YOUTUBE_SANDBOX_REFUSALS,
    YOUTUBE_STATUS_OPERATION,
    type YoutubeSandboxJob,
} from "./youtube-sandbox.catalogue"
import {
    youtubeGrantRevoked,
    youtubeQuotaExceeded,
    youtubeRefreshUnreachable,
    youtubeServerError,
    youtubeUnreachable,
    youtubeUploadLimitExceeded,
} from "./youtube-sandbox.failures"

/** State name: the videos the account uploaded, by video id. */
const VIDEO = "video"

/** A video as the account's state keeps it: its job, the privacy it was given and how many status reads walked the job. */
interface KeptVideo {
    readonly job: YoutubeSandboxJob
    readonly privacyStatus: string
    readonly polls: number
}

/** Where a video stands by its documented `uploadStatus` alone (the live adapter's own table). */
const STATE_OF_UPLOAD: Readonly<Record<string, YoutubeVideoState>> = {
    uploaded: "pending",
    processed: "done",
    failed: "failed",
    rejected: "failed",
    deleted: "failed",
}

/** The refusal a refusing case throws, or null when the picked case refuses nothing. */
const refusalOf = (nextCase: string | null): ProviderRegistryError | null => {
    const refusal = nextCase === null ? undefined : YOUTUBE_SANDBOX_REFUSALS[nextCase]
    return refusal === undefined ? null : withProof(providerRefusal(PROVIDER.google, refusal.reason, refusal.detail), "not_sent")
}

@Injectable()
/**
 * YouTube's (through the `google` account) SANDBOX implementation of the YouTube destination (`YoutubePublishPort`; owner rulings R56,
 * R59, R60, R62): used when the Google account is a sandbox account. It answers through the generic sandbox frame from the hardcoded
 * `YOUTUBE-<n>` catalogue and never reaches a host (the file store is not read: the sandbox holds no bytes). The account's NEXT CASE of
 * each operation (`youtube.publish`, `youtube.status`) picks the answer (sticky; the operation's default while nothing is picked); the
 * request's words pick nothing. Like the live twin, `publish` refuses a thumbnail `not_available` first; a refusing case throws exactly the
 * live refusal (`providerRefusal` proving `not_sent`); a quota answer, a 5xx, a lost answer, a revoked grant and an unreachable token
 * refresh throw the live failures (`youtube-sandbox.failures.ts`: the same `YoutubeError` through the live mapping). An accepted upload is
 * answered `uploaded` with the privacy it was given (`private` when none) and kept in state; a playlist add answers a playlist item id, or
 * `playlistFailure: "not_found"` under `YOUTUBE-8` (the video exists, as live). The later outcome arrives by the live poll: `status` walks
 * the video's steps one per read and stays on the last (processed, failed with a reason, rejected with a reason, deleted, or processing
 * for ever). Video ids run `sbx-yt-video-<n>` by the uploads the account took (`state.seq`). The sandbox adds no idempotency.
 */
export class YoutubeSandboxVideoService implements YoutubePublishPort {
    /** The provider key. */
    readonly provider: string = PROVIDER.google

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Uploads one video of a sandbox account through exactly one sandbox call keyed by the title. */
    async publish(_workspaceId: string, connection: ConnectionRecord, request: YoutubeVideoRequest): Promise<YoutubeVideo> {
        return await this.sandbox.call(connection, YOUTUBE_PUBLISH_OPERATION, request, {
            key: request.title,
            answer: async (state) => {
                if (request.thumbnail !== null) {
                    const thumbnail = YOUTUBE_SANDBOX_REFUSALS[YOUTUBE_CASE.thumbnail]
                    throw withProof(providerRefusal(PROVIDER.google, thumbnail?.reason ?? "not_available", thumbnail?.detail ?? null), "not_sent")
                }
                const refusal = refusalOf(state.nextCase)
                if (refusal !== null) throw refusal
                if (state.nextCase === YOUTUBE_CASE.quotaExceeded) throw youtubeQuotaExceeded()
                if (state.nextCase === YOUTUBE_CASE.serverError) throw youtubeServerError()
                if (state.nextCase === YOUTUBE_CASE.timeout) throw youtubeUnreachable()
                if (state.nextCase === YOUTUBE_CASE.uploadLimit) throw youtubeUploadLimitExceeded()
                if (state.nextCase === YOUTUBE_CASE.grantRevoked) throw youtubeGrantRevoked()
                if (state.nextCase === YOUTUBE_CASE.refreshUnreachable) throw youtubeRefreshUnreachable()
                const number = String(state.seq + 1).padStart(6, "0")
                const videoId = `sbx-yt-video-${number}`
                const kept: KeptVideo = {
                    job: (state.nextCase === null ? undefined : YOUTUBE_SANDBOX_JOBS[state.nextCase]) ?? YOUTUBE_SANDBOX_DEFAULT_JOB,
                    privacyStatus: request.privacyStatus ?? "private",
                    polls: 0,
                }
                await state.write(VIDEO, videoId, kept)
                if (state.nextCase === YOUTUBE_CASE.appliedNoAnswer) throw youtubeUnreachable()
                const missing = request.playlistId !== null && state.nextCase === YOUTUBE_CASE.playlistMissing
                return {
                    videoId,
                    state: "pending",
                    uploadStatus: "uploaded",
                    reason: null,
                    privacyStatus: kept.privacyStatus,
                    processingStatus: null,
                    playlistItemId: request.playlistId === null || missing ? null : `sbx-yt-item-${number}`,
                    playlistFailure: missing ? YOUTUBE_SANDBOX_PLAYLIST_FAILURE : null,
                }
            },
        })
    }

    /** The video as it stands through exactly one sandbox call keyed by the video id; each read moves the video one step on. */
    async status(connection: ConnectionRecord, videoId: string): Promise<YoutubeVideo> {
        return await this.sandbox.call(connection, YOUTUBE_STATUS_OPERATION, { videoId }, {
            key: videoId,
            answer: async (state) => {
                const refusal = refusalOf(state.nextCase)
                if (refusal !== null) throw refusal
                if (state.nextCase === YOUTUBE_CASE.statusQuotaExceeded) throw youtubeQuotaExceeded()
                if (state.nextCase === YOUTUBE_CASE.statusTimeout) throw youtubeUnreachable()
                const value = await state.read(VIDEO, videoId)
                if (value === null) throw withProof(providerRefusal(PROVIDER.google, "not_found", "video"), "not_sent")
                const kept = value as KeptVideo
                const step = kept.job.steps[Math.min(kept.polls, kept.job.steps.length - 1)] ?? YOUTUBE_SANDBOX_DEFAULT_JOB.steps[0]
                await state.write(VIDEO, videoId, { ...kept, polls: kept.polls + 1 })
                return {
                    videoId,
                    state: STATE_OF_UPLOAD[step?.uploadStatus ?? ""] ?? "pending",
                    uploadStatus: step?.uploadStatus ?? "",
                    reason: step?.reason ?? null,
                    privacyStatus: kept.privacyStatus,
                    processingStatus: step?.processingStatus ?? null,
                    playlistItemId: null,
                    playlistFailure: null,
                }
            },
        })
    }
}
