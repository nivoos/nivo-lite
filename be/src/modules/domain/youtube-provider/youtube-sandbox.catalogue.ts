import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The operations in the sandbox call log and in the account's next-case selector (`<capability>.<verb>`: the key `google` is shared with the calendar and the ledger). */
export const YOUTUBE_PUBLISH_OPERATION = "youtube.publish"
export const YOUTUBE_STATUS_OPERATION = "youtube.status"

/** The case ids by what they do, so the service and its specs name no bare number. */
export const YOUTUBE_CASE = {
    accepted: "YOUTUBE-1",
    playlist: "YOUTUBE-2",
    processingFailed: "YOUTUBE-3",
    copyright: "YOUTUBE-4",
    fileNotFound: "YOUTUBE-5",
    authRefused: "YOUTUBE-6",
    thumbnail: "YOUTUBE-7",
    playlistMissing: "YOUTUBE-8",
    statusNotFound: "YOUTUBE-9",
    neverFinishes: "YOUTUBE-10",
    quotaExceeded: "YOUTUBE-11",
    serverError: "YOUTUBE-12",
    timeout: "YOUTUBE-13",
    appliedNoAnswer: "YOUTUBE-14",
    statusRead: "YOUTUBE-15",
    statusAuthRefused: "YOUTUBE-16",
    statusQuotaExceeded: "YOUTUBE-17",
    statusTimeout: "YOUTUBE-18",
    deleted: "YOUTUBE-19",
    uploadLimit: "YOUTUBE-20",
    grantRevoked: "YOUTUBE-21",
    refreshUnreachable: "YOUTUBE-22",
} as const

/** One step of a video's processing as one status read answers it (YouTube's own words of the Video resource). */
export interface YoutubeSandboxStep {
    /** `status.uploadStatus`. */
    readonly uploadStatus: "uploaded" | "processed" | "failed" | "rejected" | "deleted"
    /** `processingDetails.processingStatus`. */
    readonly processingStatus: "processing" | "succeeded" | "failed" | "terminated"
    /** `status.failureReason` or `status.rejectionReason`, else null. */
    readonly reason: string | null
}

/** The steps a video walks, one per status read; the last one is where it stays. */
export interface YoutubeSandboxJob {
    /** The steps, in order. */
    readonly steps: ReadonlyArray<YoutubeSandboxStep>
}

/** The job a publish with no named case starts (the default `YOUTUBE-1`): uploaded, then processed. */
export const YOUTUBE_SANDBOX_DEFAULT_JOB: YoutubeSandboxJob = {
    steps: [
        { uploadStatus: "uploaded", processingStatus: "processing", reason: null },
        { uploadStatus: "processed", processingStatus: "succeeded", reason: null },
    ],
}

/** The job a publish case starts, by case id (the account's next case of `youtube.publish` decides the video's fate). */
export const YOUTUBE_SANDBOX_JOBS: Readonly<Record<string, YoutubeSandboxJob>> = {
    [YOUTUBE_CASE.processingFailed]: {
        steps: [
            { uploadStatus: "uploaded", processingStatus: "processing", reason: null },
            { uploadStatus: "failed", processingStatus: "failed", reason: "codec" },
        ],
    },
    [YOUTUBE_CASE.copyright]: {
        steps: [
            { uploadStatus: "uploaded", processingStatus: "processing", reason: null },
            { uploadStatus: "rejected", processingStatus: "terminated", reason: "copyright" },
        ],
    },
    [YOUTUBE_CASE.neverFinishes]: { steps: [{ uploadStatus: "uploaded", processingStatus: "processing", reason: null }] },
    [YOUTUBE_CASE.deleted]: {
        steps: [
            { uploadStatus: "uploaded", processingStatus: "processing", reason: null },
            { uploadStatus: "deleted", processingStatus: "terminated", reason: null },
        ],
    },
}

/** How a refusing case ends: the refusal the live twin throws for a YouTube answer, with the provider's words as the detail. */
export interface YoutubeSandboxRefusal {
    /** The refusal. */
    readonly reason: "rejected" | "not_found" | "auth_refused" | "not_available"
    /** The provider's words, which ride as the detail. */
    readonly detail: string
}

/** The refusing cases, by case id (picked by the account's next case of the operation; the request's own words never pick one). */
export const YOUTUBE_SANDBOX_REFUSALS: Readonly<Record<string, YoutubeSandboxRefusal>> = {
    [YOUTUBE_CASE.fileNotFound]: { reason: "not_found", detail: "video file" },
    [YOUTUBE_CASE.authRefused]: { reason: "auth_refused", detail: "Invalid Credentials" },
    [YOUTUBE_CASE.thumbnail]: { reason: "not_available", detail: "thumbnails.set: docs-missing" },
    [YOUTUBE_CASE.statusNotFound]: { reason: "not_found", detail: "video" },
    [YOUTUBE_CASE.statusAuthRefused]: { reason: "auth_refused", detail: "Invalid Credentials" },
}

/** The `playlistFailure` word a failed playlist add answers (the video exists, as live). */
export const YOUTUBE_SANDBOX_PLAYLIST_FAILURE = "not_found"

const on = (operation: string) => (id: string, label: string, outcome: NonNullable<SandboxCase["outcome"]>, isDefault = false): SandboxCase => ({
    id,
    label,
    operation,
    outcome,
    ...(isDefault ? { default: true as const } : {}),
})
const publish = on(YOUTUBE_PUBLISH_OPERATION)
const status = on(YOUTUBE_STATUS_OPERATION)

/**
 * The cases of the YouTube publishing sandbox (R62 next-case shape: ONE default per operation, answered while nothing is picked; every other
 * case is picked per account and operation and is STICKY). A PUBLISH case also decides the video's fate: the steps its later
 * `youtube.status` reads walk (YouTube's own `uploadStatus` words, which the live adapter maps to pending / done / failed). An upload that
 * names a playlist is added to it, and one with a thumbnail is refused `not_available` before anything is sent, whatever case is picked
 * (the live adapter's own behaviour). Words: the Data API's reasons in `youtube.client.ts` (`quotaExceeded` rate, `uploadLimitExceeded`
 * refused, 401 / `Invalid Credentials` auth) and the live adapter's own refusals.
 */
export const YOUTUBE_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    publish(YOUTUBE_CASE.accepted, "The upload is accepted; its status reads uploaded, then processed", "ok", true),
    publish(YOUTUBE_CASE.playlist, "The upload that names a playlist is added to it: the answer carries the playlist item id (as the default does when the request names one)", "ok"),
    publish(YOUTUBE_CASE.processingFailed, "The upload is accepted; its later status reads failed with the failure reason codec", "ok"),
    publish(YOUTUBE_CASE.copyright, "The upload is accepted; its later status reads rejected with the reason copyright", "ok"),
    publish(YOUTUBE_CASE.fileNotFound, "Refused: the file store holds no such video within the size limit (not found, nothing uploaded)", "refused"),
    publish(YOUTUBE_CASE.authRefused, "Refused: the credential is no longer valid (auth refused, nothing uploaded); sticky, so every call is refused until the owner picks another case", "refused"),
    publish(YOUTUBE_CASE.thumbnail, "An upload with a thumbnail is refused before anything is sent (not available, thumbnails.set: docs-missing); the default refuses it too", "refused"),
    publish(YOUTUBE_CASE.playlistMissing, "The upload is accepted and the video exists; the playlist add failed: playlistFailure not_found (a request that names no playlist is answered like the default)", "ok"),
    status(YOUTUBE_CASE.statusNotFound, "Reading the status of a video the account never uploaded answers not found", "refused"),
    publish(YOUTUBE_CASE.neverFinishes, "The upload is accepted and its status stays uploaded / processing on every read, for ever", "ok"),
    publish(YOUTUBE_CASE.quotaExceeded, "The Data API answers quotaExceeded: nothing uploaded, a retry may pass", "transient"),
    publish(YOUTUBE_CASE.serverError, "The Data API answers a 5xx: the outcome is unknown, nothing uploaded", "transient"),
    publish(YOUTUBE_CASE.timeout, "No answer arrives: the outcome is unknown and nothing was uploaded", "timeout"),
    publish(YOUTUBE_CASE.appliedNoAnswer, "No answer arrives, but the video WAS uploaded (the next running video id; a status read finds it)", "timeout"),
    status(YOUTUBE_CASE.statusRead, "The status read answers where the video stands (the steps its publish case set)", "ok", true),
    status(YOUTUBE_CASE.statusAuthRefused, "The status read is refused: the credential is no longer valid", "refused"),
    status(YOUTUBE_CASE.statusQuotaExceeded, "The status read hits quotaExceeded: a retry may pass", "transient"),
    status(YOUTUBE_CASE.statusTimeout, "The status read never answers", "timeout"),
    publish(YOUTUBE_CASE.deleted, "The upload is accepted; its later status reads deleted (YouTube removed it after processing): failed", "ok"),
    publish(YOUTUBE_CASE.uploadLimit, "Refused: the channel's upload limit is used up (reason uploadLimitExceeded, rejected, nothing uploaded)", "refused"),
    publish(YOUTUBE_CASE.grantRevoked, "Refused: the owner revoked the Google grant (invalid_grant: the token store answers GOOGLE_CONNECTIONS_LOST, nothing sent); sticky until another case is picked", "refused"),
    publish(YOUTUBE_CASE.refreshUnreachable, "The token refresh cannot reach Google: nothing sent, a retry may pass", "transient"),
]

/** The hardcoded catalogue of the YouTube publishing sandbox (ruling R60): ids `YOUTUBE-<n>`, identical on every machine. */
export const YOUTUBE_SANDBOX_CATALOGUE: SandboxCatalogue = { provider: PROVIDER.google, cases: YOUTUBE_SANDBOX_CASES }
