import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * JSON2VIDEO'S SANDBOX COVERAGE (SBX standard 2026-11-15): every situation of every role the provider plays, by case id or by the reason it
 * cannot happen at JSON2Video. Roles: `inbound` (the render webhook), `job` + `act` on `start` (a movie started: its life, and what the
 * start call itself can come to), `read` on `statusOf`, `connection` (an API key). Shapes come from json2video-status.policy.ts
 * (`completionOf`: `success` true with an https `url`, `success` false with `error`, the dashboard's `test` ping).
 */
export const JSON2VIDEO_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "json2video",
    roles: [
        {
            role: "inbound",
            shapes: { succeeded: ["JSON2VIDEO-6"], failed: ["JSON2VIDEO-7"] },
            covers: {
                // The render door keeps a finished render by its project id and fires `render.completed`; no run waits for an id the account never started.
                "inbound.unknown_sender": { cases: ["JSON2VIDEO-18"] },
                // The dashboard's Test sends `test: true`: `completionOf` reports no finished render, the door keeps nothing.
                "inbound.not_a_line": { cases: ["JSON2VIDEO-8"] },
                // success true without an https video address: the mapper reads no finished render. The render door acknowledges HTTP 200 for every
                // body it cannot use (a retry would be pointless) and keeps nothing: no typed refusal exists at this door, the proof is "nothing kept".
                "inbound.malformed": { cases: ["JSON2VIDEO-17"] },
                "inbound.withheld": {
                    na: "the render trigger is webhook only (RENDER_WITHOUT_POLL): JSON2Video reads one movie by its project, it has no call that lists movies, so no poll can find a withheld callback",
                },
            },
        },
        {
            role: "job",
            operation: "start",
            covers: {
                "job.done": { cases: ["JSON2VIDEO-1"] },
                // JSON2VIDEO-2 fails with the provider's own words; JSON2VIDEO-19 is the client's 15-minute timeout, failed with JSON2VIDEO_TIMEOUT_WORDS.
                "job.failed": { cases: ["JSON2VIDEO-2", "JSON2VIDEO-19"] },
                "job.never_finishes": { cases: ["JSON2VIDEO-9"] },
                "job.callback_done": { cases: ["JSON2VIDEO-6"] },
                "job.callback_failed": { cases: ["JSON2VIDEO-7"] },
                // A render started by JSON2VIDEO-1 whose callback is simply never sent: the render trigger is `via: ["webhook"]` withoutPoll
                // (RENDER_WITHOUT_POLL, video-render.words.ts), so the run's own deadline reads the movie with `video.render.get` (`statusOf`,
                // JSON2VIDEO-13) and finds the end.
                "job.callback_lost": { cases: ["JSON2VIDEO-1"] },
                "job.unknown_job": { cases: ["JSON2VIDEO-5"] },
            },
        },
        {
            role: "act",
            operation: "start",
            covers: {
                "act.final": {
                    na: "video.compose declares no final refusal: every refusal JSON2Video gives (no credits, a refused key, an unusable spec) is one a person can resolve, so it is always a stop",
                },
                // JSON2VIDEO-4: a 5xx after the movie was started: the render exists, the start answer says unknown.
                "act.unknown_applied": { cases: ["JSON2VIDEO-4"] },
                "act.confirm_read": {
                    na: "video.compose declares no confirmBy: a start whose answer was lost has no project id at NIVO, so no status read can find that movie by id",
                },
                "act.replay": {
                    na: "JSON2Video takes no idempotency key when a movie is created: a second start makes a second movie, so the sandbox keeps no replay either",
                },
                "act.partial": { na: "a start makes exactly one movie from one spec: there is no batch whose parts could be partly done" },
            },
        },
        {
            role: "read",
            operation: "statusOf",
            covers: {
                "read.not_found": { cases: ["JSON2VIDEO-5"] },
                "read.page": { na: "a status read answers one movie by its project id: nothing is listed or paged" },
            },
        },
        {
            role: "connection",
            covers: {
                // The key is refused at the start (401) and at the status read (401).
                "connection.credential_refused": { cases: ["JSON2VIDEO-10", "JSON2VIDEO-14"] },
                "connection.revoked": {
                    na: "a JSON2Video API key has no separate revocation: a key removed at the provider is answered 401 like a wrong one (credential_refused)",
                },
                "connection.refresh": { na: "an API key is not refreshed: there is no token that can expire or be refreshed by another worker" },
            },
        },
    ],
}
