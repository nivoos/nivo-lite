import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * VEO'S SANDBOX COVERAGE (SBX standard 2026-11-15): every situation of every role the provider plays, by case id or by the reason it
 * cannot happen at Veo. Veo has no inbound cases (a long-running operation is only POLLED, Veo sends no webhook to NIVO), so no inbound
 * role. Roles: `job` + `act` on `start` (a generation started: its life, and what the start call itself can come to), `read` on `get`
 * (the operation) and on `file` (the video behind its URI), `connection` (an API key).
 */
export const VEO_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "veo",
    roles: [
        {
            role: "job",
            operation: "start",
            covers: {
                "job.done": { cases: ["VEO-1"] },
                // VEO-2 ends failed with Google's code and words; VEO-3 ends done with no video (the provider's filters blocked it).
                "job.failed": { cases: ["VEO-2", "VEO-3"] },
                "job.never_finishes": { cases: ["VEO-10"] },
                "job.callback_done": { na: "Veo sends no callback to NIVO: a generation is a long-running operation the engine only polls with `get`, so there is no callback that could report it done" },
                "job.callback_failed": { na: "Veo sends no callback to NIVO: a generation is a long-running operation the engine only polls with `get`, so there is no callback that could report it failed" },
                "job.callback_lost": { na: "Veo has no callback that could be lost: the run reads the operation itself with `get` until it ends (every read is the poll)" },
                "job.unknown_job": { cases: ["VEO-7"] },
            },
        },
        {
            role: "act",
            operation: "start",
            covers: {
                "act.final": {
                    na: "video.generate declares no final refusal: every refusal Google gives (a refused prompt, no model, a refused key) is one a person can resolve, so it is always a stop",
                },
                // VEO-5: a 5xx after the operation was started: it exists, the start answer says unknown.
                "act.unknown_applied": { cases: ["VEO-5"] },
                "act.confirm_read": {
                    na: "video.generate declares no confirmBy: a start whose answer was lost has no operation name at NIVO, so no read can find that generation by name",
                },
                "act.replay": {
                    na: "predictLongRunning takes no idempotency key: a second start makes a second generation, so the sandbox keeps no replay either",
                },
                "act.partial": { na: "a start makes exactly one generation from one prompt: there is no batch whose parts could be partly done" },
            },
        },
        {
            role: "read",
            operation: "get",
            covers: {
                "read.not_found": { cases: ["VEO-7"] },
                "read.page": { na: "a read answers one operation by its name: nothing is listed or paged" },
            },
        },
        {
            role: "read",
            operation: "file",
            covers: {
                "read.not_found": { cases: ["VEO-9"] },
                "read.page": { na: "a video is fetched whole by its URI: nothing is listed or paged" },
            },
        },
        {
            role: "connection",
            covers: {
                // The key is refused at the start (403), at the operation read (403) and at the video fetch (403).
                "connection.credential_refused": { cases: ["VEO-11", "VEO-15", "VEO-18"] },
                "connection.revoked": {
                    na: "a Gemini API key has no separate revocation: a key removed at the provider is answered 403 like a wrong one (credential_refused)",
                },
                "connection.refresh": { na: "an API key is not refreshed: there is no token that can expire or be refreshed by another worker" },
            },
        },
    ],
}
