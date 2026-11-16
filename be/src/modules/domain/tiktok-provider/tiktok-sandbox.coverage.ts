import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"
import {
    TIKTOK_CASE,
    TIKTOK_CREATOR_OPERATION,
    TIKTOK_PUBLISH_OPERATION,
    TIKTOK_STATUS_OPERATION,
} from "./tiktok-sandbox.catalogue"

/** The reason no callback exists: the live adapter learns a post's end only by polling `status`; no TikTok route is in `features/webhooks`. */
const POLLED_ONLY =
    "TikTok's Content Posting API is polled by the live adapter (the status read) and NIVO has no TikTok webhook route (features/webhooks holds none), so no callback exists that could report, or lose, the post's end."

/**
 * TikTok's NIVO Sandbox as the standard asks it (lane concept provider-sandbox rule 18). TikTok plays the destination port
 * (`TiktokPublishPort`): `publish` starts a long job (`job` + `act`), `status` reads it, `creator` reads what the account may post with,
 * and the account holds an OAuth token that refreshes (`connection`). No inbound role: TikTok sends nothing to NIVO.
 */
export const TIKTOK_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "tiktok",
    roles: [
        {
            role: "act",
            operation: TIKTOK_PUBLISH_OPERATION,
            covers: {
                "act.final": {
                    na: "tiktok.video.publish declares no finalRefusals in tool-specs.policy.ts, so every refusal of the post is a failed act a person can resolve and none is a business answer.",
                },
                "act.unknown_applied": { cases: [TIKTOK_CASE.appliedNoAnswer] },
                "act.confirm_read": {
                    na: "tiktok.video.publish declares no confirmBy, and a lost answer is the only place the new publish id was told, so the engine cannot name which post a status read should confirm.",
                },
                "act.replay": {
                    na: "TikTok's post init takes no idempotency key in the live client (tiktok.client.ts), so the same post asked again starts another post; the engine's ledger, not the provider, proves a repeat.",
                },
                "act.partial": { na: "One direct post is one init call for one video: it is started or it is not, there is no batch that could be partly done." },
            },
        },
        {
            role: "job",
            operation: TIKTOK_PUBLISH_OPERATION,
            covers: {
                "job.done": { cases: [TIKTOK_CASE.accepted, TIKTOK_CASE.completeNoIds] },
                "job.failed": { cases: [TIKTOK_CASE.processingFailed] },
                "job.never_finishes": { cases: [TIKTOK_CASE.neverFinishes] },
                "job.callback_done": { na: POLLED_ONLY },
                "job.callback_failed": { na: POLLED_ONLY },
                "job.callback_lost": { na: POLLED_ONLY },
                "job.unknown_job": { cases: [TIKTOK_CASE.statusNotFound] },
            },
        },
        {
            role: "read",
            operation: TIKTOK_STATUS_OPERATION,
            covers: {
                "read.not_found": { cases: [TIKTOK_CASE.statusNotFound] },
                "read.page": { na: "One post is read by its publish id and answers one status: there is no list, no page and no limit in the live status read." },
            },
        },
        {
            role: "read",
            operation: TIKTOK_CREATOR_OPERATION,
            covers: {
                "read.not_found": {
                    na: "The creator read asks about the authorised account itself (creator_info/query takes no id), so there is no thing it can fail to find; a missing account is the credential's refusal.",
                },
                "read.page": { na: "The creator read answers one creator's options: there is no list, no page and no limit in the live creator read." },
            },
        },
        {
            role: "connection",
            covers: {
                "connection.credential_refused": { cases: [TIKTOK_CASE.authRefused, TIKTOK_CASE.creatorAuthRefused, TIKTOK_CASE.statusAuthRefused] },
                // TikTok answers a revoked authorisation with the same 401 as an expired token (the live client types both `AuthFailed`); the
                // sticky next case keeps refusing every call until the owner picks another.
                "connection.revoked": { cases: [TIKTOK_CASE.authRefused] },
                "connection.refresh": { cases: [TIKTOK_CASE.refreshRefused] },
            },
        },
    ],
}
