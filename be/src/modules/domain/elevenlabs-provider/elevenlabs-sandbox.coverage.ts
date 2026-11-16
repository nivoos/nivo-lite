import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * ELEVENLABS' SANDBOX COVERAGE (SBX standard 2026-11-15): every situation of every role the provider plays, by case id or by the reason it
 * cannot happen at ElevenLabs. ElevenLabs has no inbound cases (a dubbing is only POLLED, it sends no webhook to NIVO), so no inbound
 * role. Roles: `read` on `voices` (the voice library), `act` on `synthesize` (speech), `job` + `act` on `create` (a dubbing started: its
 * life, and what the start call itself can come to), `read` on `get` (the dubbing) and on `file` (a dubbed language), `connection`.
 */
const NO_CALLBACK = "ElevenLabs sends no callback to NIVO: a dubbing is only polled with `get`, so there is no callback that could report it"

export const ELEVENLABS_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "elevenlabs",
    roles: [
        {
            role: "read",
            operation: "voices",
            covers: {
                "read.not_found": {
                    na: "listing voices names no single thing that could be missing: a search nothing matches answers an empty page (ELEVENLABS-2), never a not-found",
                },
                // ELEVENLABS-1: three voices paged by the page size with a next-page token.
                "read.page": { cases: ["ELEVENLABS-1"] },
            },
        },
        {
            role: "act",
            operation: "synthesize",
            covers: {
                "act.final": {
                    na: "speech.generate declares no final refusal: every refusal ElevenLabs gives (a spent quota, a voice it does not hold, a refused key) is one a person can resolve, so it is always a stop",
                },
                // ELEVENLABS-19: a 5xx; the clip may have been made and charged, and a speech makes no record NIVO could read.
                "act.unknown_applied": { cases: ["ELEVENLABS-19"] },
                "act.confirm_read": {
                    na: "speech.generate declares no confirmBy: a clip is returned in the answer itself and ElevenLabs keeps no record NIVO could read to learn whether a lost answer made one",
                },
                "act.replay": {
                    na: "the text-to-speech call takes no idempotency key: the same text asked twice makes a second clip, so the sandbox keeps no replay either",
                },
                "act.partial": { na: "a speech request turns one text into one clip: there is no batch whose parts could be partly done" },
            },
        },
        {
            role: "job",
            operation: "create",
            covers: {
                "job.done": { cases: ["ELEVENLABS-6"] },
                "job.failed": { cases: ["ELEVENLABS-7"] },
                "job.never_finishes": { cases: ["ELEVENLABS-20"] },
                "job.callback_done": { na: `${NO_CALLBACK} done` },
                "job.callback_failed": { na: `${NO_CALLBACK} failed` },
                "job.callback_lost": { na: "ElevenLabs has no callback that could be lost: the run reads the dubbing itself with `get` until it ends (every read is the poll)" },
                "job.unknown_job": { cases: ["ELEVENLABS-10"] },
            },
        },
        {
            role: "act",
            operation: "create",
            covers: {
                "act.final": {
                    na: "dubbing.create declares no final refusal: every refusal ElevenLabs gives (an unusable source, a refused key) is one a person can resolve, so it is always a stop",
                },
                // ELEVENLABS-9: a 5xx after the job was started: it exists, the start answer says unknown.
                "act.unknown_applied": { cases: ["ELEVENLABS-9"] },
                "act.confirm_read": {
                    na: "dubbing.create declares no confirmBy: a start whose answer was lost has no dubbing id at NIVO, so no read can find that job by id",
                },
                "act.replay": {
                    na: "the dubbing call takes no idempotency key: the same source asked twice starts a second job, so the sandbox keeps no replay either",
                },
                "act.partial": { na: "a dubbing start makes exactly one job (its target languages are one job's files): there is no batch whose parts could be partly done" },
            },
        },
        {
            role: "read",
            operation: "get",
            covers: {
                "read.not_found": { cases: ["ELEVENLABS-10"] },
                "read.page": { na: "a dubbing read answers one job by its id: nothing is listed or paged" },
            },
        },
        {
            role: "read",
            operation: "file",
            covers: {
                "read.not_found": { cases: ["ELEVENLABS-12"] },
                "read.page": { na: "a dubbed language is fetched whole by its handle: nothing is listed or paged" },
            },
        },
        {
            role: "connection",
            covers: {
                // The key is refused at the voice list, at speech, at the dubbing start, at the dubbing read and at the dubbed-file fetch (401 each).
                "connection.credential_refused": { cases: ["ELEVENLABS-13", "ELEVENLABS-16", "ELEVENLABS-21", "ELEVENLABS-25", "ELEVENLABS-28"] },
                "connection.revoked": {
                    na: "an ElevenLabs API key has no separate revocation: a key removed at the provider is answered 401 like a wrong one (credential_refused)",
                },
                "connection.refresh": { na: "an API key is not refreshed: there is no token that can expire or be refreshed by another worker" },
            },
        },
    ],
}
