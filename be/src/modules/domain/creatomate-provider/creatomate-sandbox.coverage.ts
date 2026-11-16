import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * CREATOMATE'S SANDBOX COVERAGE (SBX standard 2026-11-15): every situation of every role the provider plays, by case id or by the reason it
 * cannot happen at Creatomate. Roles: `inbound` (the render webhook), `job` + `act` on `start` (a render started: its life, and what the
 * start call itself can come to), `read` on `statusOf`, `connection` (an API key). Shapes come from creatomate-status.policy.ts
 * (`creatomateCompletionOf`) and the client's `creatomateRenderOf`.
 */
export const CREATOMATE_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "creatomate",
    roles: [
        {
            role: "inbound",
            // The two ends `creatomateCompletionOf` maps: `succeeded` with an https url, `failed` with error_message.
            shapes: { succeeded: ["CREATOMATE-6"], failed: ["CREATOMATE-7"] },
            covers: {
                // The render door keeps a finished render by its render id and fires `render.completed`; no run waits for an id the account never started.
                "inbound.unknown_sender": { cases: ["CREATOMATE-18"] },
                // A render still in progress (status rendering): `creatomateCompletionOf` reports no finished render, the door keeps nothing.
                "inbound.not_a_line": { cases: ["CREATOMATE-16"] },
                // succeeded without an https video address: the mapper reads no finished render. The render door acknowledges HTTP 200 for every body it
                // cannot use (a retry would be pointless) and keeps nothing: there is no typed refusal at this door, the proof is "nothing kept".
                "inbound.malformed": { cases: ["CREATOMATE-17"] },
                "inbound.withheld": {
                    na: "the render trigger is webhook only (RENDER_WITHOUT_POLL): Creatomate has no call that lists renders, so no poll can find a withheld callback; a lost one is the lost-callback case of the job",
                },
            },
        },
        {
            role: "job",
            operation: "start",
            covers: {
                "job.done": { cases: ["CREATOMATE-1"] },
                "job.failed": { cases: ["CREATOMATE-2"] },
                "job.never_finishes": { cases: ["CREATOMATE-8"] },
                "job.callback_done": { cases: ["CREATOMATE-6"] },
                "job.callback_failed": { cases: ["CREATOMATE-7"] },
                // A render started by CREATOMATE-1 whose callback is simply never sent: the render trigger is `via: ["webhook"]` withoutPoll
                // (RENDER_WITHOUT_POLL, video-render.words.ts), so the run's own deadline reads the render with `video.render.get` (`statusOf`,
                // CREATOMATE-15) and finds the end.
                "job.callback_lost": { cases: ["CREATOMATE-1"] },
                "job.unknown_job": { cases: ["CREATOMATE-5"] },
            },
        },
        {
            role: "act",
            operation: "start",
            covers: {
                "act.final": {
                    na: "video.compose declares no final refusal: every refusal Creatomate gives (no credits, a refused key, an unusable spec) is one a person can resolve, so it is always a stop",
                },
                // CREATOMATE-4: a 5xx after the render was started: the render exists, the start answer says unknown.
                "act.unknown_applied": { cases: ["CREATOMATE-4"] },
                "act.confirm_read": {
                    na: "video.compose declares no confirmBy: a start whose answer was lost has no render id at NIVO, so no status read can find that render by id",
                },
                "act.replay": {
                    na: "Creatomate takes no idempotency key on POST /v2/renders: a second start makes a second render, so the sandbox keeps no replay either",
                },
                "act.partial": { na: "a start makes exactly one render from one spec: there is no batch whose parts could be partly done" },
            },
        },
        {
            role: "read",
            operation: "statusOf",
            covers: {
                "read.not_found": { cases: ["CREATOMATE-5"] },
                "read.page": { na: "a status read answers one render by its id: nothing is listed or paged" },
            },
        },
        {
            role: "connection",
            covers: {
                // The key is refused at the start (401) and at the status read (401).
                "connection.credential_refused": { cases: ["CREATOMATE-9", "CREATOMATE-12"] },
                "connection.revoked": {
                    na: "a Creatomate API key has no separate revocation: a key removed at the provider is answered 401 like a wrong one (credential_refused)",
                },
                "connection.refresh": { na: "an API key is not refreshed: there is no token that can expire or be refreshed by another worker" },
            },
        },
    ],
}
