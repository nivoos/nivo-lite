import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * SHOTSTACK'S SANDBOX COVERAGE (SBX standard 2026-11-15): every situation of every role the provider plays, by case id or by the reason it
 * cannot happen at Shotstack. Roles: `inbound` (the render callback), `job` + `act` on `start` (a render started: its life, and what the
 * start call itself can come to), `read` on `statusOf`, `connection` (an API key). Shapes come from shotstack-callback.policy.ts
 * (`shotstackCompletionOf`: type edit, action render, status done with an https url or failed with error).
 */
export const SHOTSTACK_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "shotstack",
    roles: [
        {
            role: "inbound",
            shapes: { done: ["SHOTSTACK-6"], failed: ["SHOTSTACK-7"] },
            covers: {
                // The render door keeps a finished render by its render id and fires `render.completed`; no run waits for an id the account never started.
                "inbound.unknown_sender": { cases: ["SHOTSTACK-18"] },
                // A callback of another action (copy), as shotstack-callback.policy.spec.ts names it: not a render of an edit, nothing kept.
                "inbound.not_a_line": { cases: ["SHOTSTACK-16"] },
                // done without an https video address: the mapper reads no finished render. The render door acknowledges HTTP 200 for every body it
                // cannot use (a retry would be pointless) and keeps nothing: no typed refusal exists at this door, the proof is "nothing kept".
                "inbound.malformed": { cases: ["SHOTSTACK-17"] },
                "inbound.withheld": {
                    na: "the render trigger is webhook only (RENDER_WITHOUT_POLL): Shotstack reads one render by its id, it has no call that lists renders, so no poll can find a withheld callback",
                },
            },
        },
        {
            role: "job",
            operation: "start",
            covers: {
                "job.done": { cases: ["SHOTSTACK-1"] },
                "job.failed": { cases: ["SHOTSTACK-2"] },
                "job.never_finishes": { cases: ["SHOTSTACK-8"] },
                "job.callback_done": { cases: ["SHOTSTACK-6"] },
                "job.callback_failed": { cases: ["SHOTSTACK-7"] },
                // A render started by SHOTSTACK-1 whose callback is simply never sent: the render trigger is `via: ["webhook"]` withoutPoll
                // (RENDER_WITHOUT_POLL, video-render.words.ts), so the run's own deadline reads the render with `video.render.get` (`statusOf`,
                // SHOTSTACK-12) and finds the end.
                "job.callback_lost": { cases: ["SHOTSTACK-1"] },
                "job.unknown_job": { cases: ["SHOTSTACK-5"] },
            },
        },
        {
            role: "act",
            operation: "start",
            covers: {
                "act.final": {
                    na: "video.compose declares no final refusal: every refusal Shotstack gives (a bad edit, a refused key) is one a person can resolve, so it is always a stop",
                },
                // SHOTSTACK-4: a 5xx after the render was started: the render exists, the start answer says unknown.
                "act.unknown_applied": { cases: ["SHOTSTACK-4"] },
                "act.confirm_read": {
                    na: "video.compose declares no confirmBy: a start whose answer was lost has no render id at NIVO, so no status read can find that render by id",
                },
                "act.replay": {
                    na: "Shotstack takes no idempotency key on a render request: a second start makes a second render, so the sandbox keeps no replay either",
                },
                "act.partial": { na: "a start makes exactly one render from one edit: there is no batch whose parts could be partly done" },
            },
        },
        {
            role: "read",
            operation: "statusOf",
            covers: {
                "read.not_found": { cases: ["SHOTSTACK-5"] },
                "read.page": { na: "a status read answers one render by its id: nothing is listed or paged" },
            },
        },
        {
            role: "connection",
            covers: {
                // The key is refused at the start (401) and at the status read (401).
                "connection.credential_refused": { cases: ["SHOTSTACK-9", "SHOTSTACK-13"] },
                "connection.revoked": {
                    na: "a Shotstack API key has no separate revocation: a key removed at the provider is answered 401 like a wrong one (credential_refused)",
                },
                "connection.refresh": { na: "an API key is not refreshed: there is no token that can expire or be refreshed by another worker" },
            },
        },
    ],
}
