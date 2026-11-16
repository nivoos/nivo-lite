import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { TiktokCreator } from "@modules/domain/provider-registry"
import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The operations in the sandbox call log and in the account's next-case selector: the port's own method names. */
export const TIKTOK_CREATOR_OPERATION = "creator"
export const TIKTOK_PUBLISH_OPERATION = "publish"
export const TIKTOK_STATUS_OPERATION = "status"

/** The creator every sandbox account is (TIKTOK-1): what a post may be given and how long a video may be. */
export const TIKTOK_SANDBOX_CREATOR: TiktokCreator = {
    username: "sbx_creator",
    nickname: "Cửa hàng thử nghiệm",
    privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
    commentDisabled: false,
    duetDisabled: false,
    stitchDisabled: false,
    maxVideoPostDurationSec: 600,
}

/** The case ids by what they do, so the service and its specs name no bare number. */
export const TIKTOK_CASE = {
    creator: "TIKTOK-1",
    accepted: "TIKTOK-2",
    privacyMismatch: "TIKTOK-3",
    tooLong: "TIKTOK-4",
    authRefused: "TIKTOK-5",
    processingFailed: "TIKTOK-6",
    statusNotFound: "TIKTOK-7",
    creatorAuthRefused: "TIKTOK-8",
    creatorRateLimited: "TIKTOK-9",
    creatorTimeout: "TIKTOK-10",
    neverFinishes: "TIKTOK-11",
    completeNoIds: "TIKTOK-12",
    notConfigured: "TIKTOK-13",
    rateLimited: "TIKTOK-14",
    serverError: "TIKTOK-15",
    timeout: "TIKTOK-16",
    appliedNoAnswer: "TIKTOK-17",
    statusRead: "TIKTOK-18",
    statusAuthRefused: "TIKTOK-19",
    statusRateLimited: "TIKTOK-20",
    statusTimeout: "TIKTOK-21",
    refreshRefused: "TIKTOK-22",
} as const

/** The status words a started post walks, one per status read; the last one is where it stays. */
export interface TiktokSandboxJob {
    /** TikTok's own status words, in order (the live adapter reads `PUBLISH_COMPLETE` as published, `FAILED` as failed, anything else as pending). */
    readonly words: ReadonlyArray<string>
    /** TikTok's `fail_reason` once the last word is `FAILED`, else null. */
    readonly failReason: string | null
    /** Whether the public post id comes with `PUBLISH_COMPLETE` (TikTok withholds it for a few hours after moderation). */
    readonly withId: boolean
}

/** The job a publish case starts, by case id; a case with no entry (and the default) starts `TIKTOK-2`'s: it downloads, then completes. */
export const TIKTOK_SANDBOX_JOBS: Readonly<Record<string, TiktokSandboxJob>> = {
    [TIKTOK_CASE.accepted]: { words: ["PROCESSING_DOWNLOAD", "PUBLISH_COMPLETE"], failReason: null, withId: true },
    [TIKTOK_CASE.processingFailed]: { words: ["PROCESSING_UPLOAD", "FAILED"], failReason: "file_format_check_failed", withId: false },
    [TIKTOK_CASE.neverFinishes]: { words: ["PROCESSING_UPLOAD"], failReason: null, withId: false },
    [TIKTOK_CASE.completeNoIds]: { words: ["PROCESSING_DOWNLOAD", "PUBLISH_COMPLETE"], failReason: null, withId: false },
}

/** How a refusing case ends: the refusal the live twin throws for a TikTok answer, with TikTok's own error word as the detail. */
export interface TiktokSandboxRefusal {
    readonly reason: "rejected" | "auth_refused" | "not_found"
    readonly detail: string
}

/** The refusing cases, by case id (picked by the account's next case of the operation; the request's own words never pick one). */
export const TIKTOK_SANDBOX_REFUSALS: Readonly<Record<string, TiktokSandboxRefusal>> = {
    [TIKTOK_CASE.privacyMismatch]: { reason: "rejected", detail: "privacy_level_option_mismatch" },
    [TIKTOK_CASE.tooLong]: { reason: "rejected", detail: "video_duration_too_long" },
    [TIKTOK_CASE.authRefused]: { reason: "auth_refused", detail: "access_token_invalid" },
    [TIKTOK_CASE.statusNotFound]: { reason: "not_found", detail: "publish id not found" },
    [TIKTOK_CASE.creatorAuthRefused]: { reason: "auth_refused", detail: "access_token_invalid" },
    [TIKTOK_CASE.statusAuthRefused]: { reason: "auth_refused", detail: "access_token_invalid" },
    // The credential service's own refusal when the stored access token is expired and no refresh token is left (`tiktok-credential.service.ts` `tokenOf`).
    [TIKTOK_CASE.refreshRefused]: { reason: "auth_refused", detail: "expired" },
}

/** The digits a completed job's public post id starts with, before its running number (TikTok withholds the id until moderation; the sandbox answers it at once). */
export const TIKTOK_SANDBOX_POST_ID_PREFIX = "7300000000"

const on = (operation: string) => (id: string, label: string, outcome: NonNullable<SandboxCase["outcome"]>, isDefault = false): SandboxCase => ({
    id,
    label,
    operation,
    outcome,
    ...(isDefault ? { default: true as const } : {}),
})
const creator = on(TIKTOK_CREATOR_OPERATION)
const publish = on(TIKTOK_PUBLISH_OPERATION)
const status = on(TIKTOK_STATUS_OPERATION)

/**
 * The cases of the TikTok publishing sandbox (R62 next-case shape: ONE default per operation, answered while nothing is picked; every other
 * case is picked per account and operation and is STICKY). A PUBLISH case also decides the job it starts: the status words its later
 * `status` reads walk (the live adapter's table: `PUBLISH_COMPLETE` published, `FAILED` failed, anything else pending). A privacy level the
 * creator does not list is refused `rejected` whatever case is picked (`TIKTOK-3`, what TikTok answers to it). Words: the live client's
 * error table (`tiktok.client.ts`: 401 token, 429 rate, 5xx may have acted) and TikTok's own status and error words quoted in the port.
 */
export const TIKTOK_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    creator(TIKTOK_CASE.creator, "The creator of a sandbox account: three privacy levels, comments, duets and stitches on, up to 600 seconds", "ok", true),
    publish(TIKTOK_CASE.accepted, "The post is accepted; its status reads PROCESSING_DOWNLOAD, then PUBLISH_COMPLETE with the public post id", "ok", true),
    publish(TIKTOK_CASE.privacyMismatch, "A privacy level the creator's options do not list is refused (rejected, privacy_level_option_mismatch, nothing started)", "refused"),
    publish(TIKTOK_CASE.tooLong, "The video is longer than the creator may post: refused (rejected, nothing started)", "refused"),
    publish(TIKTOK_CASE.authRefused, "Refused: the access token is no longer valid (auth refused, nothing started); sticky, so every call is refused until the owner picks another case", "refused"),
    publish(TIKTOK_CASE.processingFailed, "The post is accepted; its later status reads FAILED with fail_reason file_format_check_failed", "ok"),
    status(TIKTOK_CASE.statusNotFound, "Reading the status of a publish id the account never started answers not found", "refused"),
    creator(TIKTOK_CASE.creatorAuthRefused, "The creator read is refused: the access token is no longer valid", "refused"),
    creator(TIKTOK_CASE.creatorRateLimited, "The creator read hits TikTok's rate limit (429): a retry may pass", "transient"),
    creator(TIKTOK_CASE.creatorTimeout, "The creator read never answers", "timeout"),
    publish(TIKTOK_CASE.neverFinishes, "The post is accepted and its status stays PROCESSING_UPLOAD on every read, for ever", "ok"),
    publish(TIKTOK_CASE.completeNoIds, "The post is accepted; its status reads PUBLISH_COMPLETE but TikTok has not given the public post id yet (withheld until moderation): no post ids", "ok"),
    publish(TIKTOK_CASE.notConfigured, "This deployment has no TikTok app client: refused not_available (app client), nothing started", "refused"),
    publish(TIKTOK_CASE.rateLimited, "TikTok answers 429: nothing started, a retry may pass", "transient"),
    publish(TIKTOK_CASE.serverError, "TikTok answers a 5xx: the outcome is unknown, nothing started", "transient"),
    publish(TIKTOK_CASE.timeout, "No answer arrives: the outcome is unknown and nothing was started", "timeout"),
    publish(TIKTOK_CASE.appliedNoAnswer, "No answer arrives, but the post WAS started (the next running publish id; a status read finds it)", "timeout"),
    status(TIKTOK_CASE.statusRead, "The status read answers where the post stands (the status words its publish case set)", "ok", true),
    status(TIKTOK_CASE.statusAuthRefused, "The status read is refused: the access token is no longer valid", "refused"),
    status(TIKTOK_CASE.statusRateLimited, "The status read hits TikTok's rate limit (429): a retry may pass", "transient"),
    status(TIKTOK_CASE.statusTimeout, "The status read never answers", "timeout"),
    publish(TIKTOK_CASE.refreshRefused, "The access token expired and its refresh token is refused or gone: auth refused (expired), nothing started; sticky until another case is picked", "refused"),
]

/** The hardcoded catalogue of the TikTok publishing sandbox (ruling R60): ids `TIKTOK-<n>`, identical on every machine. */
export const TIKTOK_SANDBOX_CATALOGUE: SandboxCatalogue = { provider: PROVIDER.tiktok, cases: TIKTOK_SANDBOX_CASES }
