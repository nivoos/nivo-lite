import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"
import { YOUTUBE_CASE, YOUTUBE_PUBLISH_OPERATION, YOUTUBE_STATUS_OPERATION } from "./youtube-sandbox.catalogue"

/** The reason no callback exists: the live adapter learns a video's end only by polling `status`; no YouTube route is in `features/webhooks`. */
const POLLED_ONLY =
    "The live YouTube adapter learns a video's processing end only by polling the status read, and NIVO has no YouTube push or webhook route (features/webhooks holds none), so no callback exists that could report, or lose, it."

/**
 * YouTube's NIVO Sandbox as the standard asks it (lane concept provider-sandbox rule 18), for the YouTube capability of the `google`
 * account (the Calendar and the ledger of the same key declare their own coverage). `youtube.publish` starts a long job (`job` + `act`),
 * `youtube.status` reads it, and the Google grant is the account's credential (`connection`). No inbound role: YouTube sends nothing to NIVO.
 */
export const YOUTUBE_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "google",
    roles: [
        {
            role: "act",
            operation: YOUTUBE_PUBLISH_OPERATION,
            covers: {
                "act.final": {
                    na: "youtube.video.publish declares no finalRefusals in tool-specs.policy.ts, so every refusal of the upload is a failed act a person can resolve and none is a business answer.",
                },
                "act.unknown_applied": { cases: [YOUTUBE_CASE.appliedNoAnswer] },
                "act.confirm_read": {
                    na: "youtube.video.publish declares no confirmBy, and a lost answer is the only place the new video id was told, so the engine cannot name which video a status read should confirm.",
                },
                "act.replay": {
                    na: "The Data API's videos.insert is sent without an idempotency key by the live client (youtube.client.ts), so the same upload asked again uploads again; the engine's ledger, not the provider, proves a repeat.",
                },
                // The upload and the playlist add are two calls of one act: the upload can succeed and the playlist add fail (the video exists).
                "act.partial": { cases: [YOUTUBE_CASE.playlistMissing] },
            },
        },
        {
            role: "job",
            operation: YOUTUBE_PUBLISH_OPERATION,
            covers: {
                "job.done": { cases: [YOUTUBE_CASE.accepted] },
                "job.failed": { cases: [YOUTUBE_CASE.processingFailed, YOUTUBE_CASE.copyright, YOUTUBE_CASE.deleted] },
                "job.never_finishes": { cases: [YOUTUBE_CASE.neverFinishes] },
                "job.callback_done": { na: POLLED_ONLY },
                "job.callback_failed": { na: POLLED_ONLY },
                "job.callback_lost": { na: POLLED_ONLY },
                "job.unknown_job": { cases: [YOUTUBE_CASE.statusNotFound] },
            },
        },
        {
            role: "read",
            operation: YOUTUBE_STATUS_OPERATION,
            covers: {
                "read.not_found": { cases: [YOUTUBE_CASE.statusNotFound] },
                "read.page": { na: "One video is read by its id and answers one status: there is no list, no page and no limit in the live status read." },
            },
        },
        {
            role: "connection",
            covers: {
                "connection.credential_refused": { cases: [YOUTUBE_CASE.authRefused, YOUTUBE_CASE.statusAuthRefused] },
                // The owner revoked the grant at Google: the token store throws GOOGLE_CONNECTIONS_LOST on every call until the owner connects again.
                "connection.revoked": { cases: [YOUTUBE_CASE.grantRevoked] },
                "connection.refresh": { cases: [YOUTUBE_CASE.refreshUnreachable] },
            },
        },
    ],
}
