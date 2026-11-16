import type { SpeechVoice } from "@modules/domain/provider-registry"
import type { SandboxCatalogue } from "@modules/domain/provider-sandbox"

/*
 * ELEVENLABS' SANDBOX CATALOGUE (owner ruling R60; SBX standard 2026-11-15): fixed named cases `ELEVENLABS-<n>`, identical on every
 * machine, for the three ports ElevenLabs registers: speech (voices, synthesize), dubbing (create, get: a job started, then POLLED:
 * ElevenLabs sends no webhook to NIVO, so the catalogue has no inbound case) and the files it holds (a dubbed language reopened by its
 * handle). Every outbound operation is answered by the account's NEXT CASE of that operation (the Sandbox page / `setSandboxNextCase`,
 * sticky; the default is the operation's success case), no magic voice id and no magic source address: a dubbing's WHOLE LIFE (done,
 * failed, never finishes) is chosen at `create` by the case and lived out by the `get` reads from the account's state. What the request
 * itself decides stays the request's: a voice the catalogue does not hold is a not-found, a search names its voices, a page token names
 * its offset (the live twin answers them from the request too). The refusal words are representative: the live adapter carries whatever
 * words ElevenLabs answered. Failures are the live adapter's (elevenlabs-failure.policy.ts), built from the client's own error.
 */

/** The provider key of the catalogue. */
export const ELEVENLABS_SANDBOX_PROVIDER = "elevenlabs"

/** The voices every sandbox account lists, in their order (the library of the catalogue). */
export const ELEVENLABS_SANDBOX_VOICES: ReadonlyArray<SpeechVoice> = [
    {
        voiceId: "SBX-VOICE-RACHEL",
        name: "Rachel",
        category: "premade",
        labels: { accent: "american", gender: "female", use_case: "narration" },
        previewUrl: "https://sandbox.nivo.test/elevenlabs/previews/rachel.mp3",
    },
    {
        voiceId: "SBX-VOICE-ADAM",
        name: "Adam",
        category: "premade",
        labels: { accent: "american", gender: "male", use_case: "narration" },
        previewUrl: "https://sandbox.nivo.test/elevenlabs/previews/adam.mp3",
    },
    {
        voiceId: "SBX-VOICE-LIEN",
        name: "Lien",
        category: "generated",
        labels: { accent: "northern", gender: "female", use_case: "conversational" },
        previewUrl: null,
    },
]

/** The searches the catalogue names, with the voice ids each finds; a search it does not name finds none. */
export const ELEVENLABS_SANDBOX_SEARCHES: Readonly<Record<string, ReadonlyArray<string>>> = {
    Rachel: ["SBX-VOICE-RACHEL"],
    narration: ["SBX-VOICE-RACHEL", "SBX-VOICE-ADAM"],
}

/** The prefix of a page token: `SBX-PAGE-<offset>` is the point to page from. */
export const ELEVENLABS_SANDBOX_PAGE_TOKEN_PREFIX = "SBX-PAGE-"

/** ElevenLabs' words for a page token it never issued (a 4xx: `rejected`). */
export const ELEVENLABS_SANDBOX_PAGE_TOKEN_MESSAGE = "The next_page_token is not valid."

/** The media type and bytes of every synthesized clip (a fixed small content: the bytes carry the voice that spoke). */
export const ELEVENLABS_SANDBOX_SPEECH_MIME = "audio/mpeg"

/** The bytes of the clip a voice speaks: fixed, naming the voice and the text. */
export const elevenLabsSandboxClipOf = (voiceId: string, text: string): Buffer => Buffer.from(`SBX-SPEECH|${voiceId}|${text}`, "utf8")

/** The bytes of one dubbed language of a dubbing: fixed. */
export const elevenLabsSandboxDubbedBytesOf = (dubbingId: string, language: string): Buffer => Buffer.from(`SBX-DUBBED|${dubbingId}|${language}`, "utf8")

/** ElevenLabs' words when the quota of the account is spent (an answered refusal: `rejected`). */
export const ELEVENLABS_SANDBOX_QUOTA_MESSAGE = "This request exceeds your quota limit."

/** ElevenLabs' words for a voice the account does not hold (a 404). */
export const ELEVENLABS_SANDBOX_VOICE_NOT_FOUND_MESSAGE = "A voice with the voice id was not found."

/** ElevenLabs' words for a dubbing the account does not hold (a 404). */
export const ELEVENLABS_SANDBOX_DUBBING_NOT_FOUND_MESSAGE = "Dubbing project not found."

/** ElevenLabs' words when a dubbing source cannot be used (a 4xx: `rejected`). */
export const ELEVENLABS_SANDBOX_SOURCE_REFUSED_MESSAGE = "The source URL could not be fetched."

/** The failure words of a dub that ends in error. */
export const ELEVENLABS_SANDBOX_DUBBING_ERROR = "Dubbing failed: no speech was detected in the source."

/** The status word of a dub in progress and of a finished one (the reference's example). */
export const ELEVENLABS_SANDBOX_DUBBING_STATUSES = { running: "dubbing", done: "dubbed", failed: "failed" } as const

/** How long ElevenLabs says a dub takes (seconds). */
export const ELEVENLABS_SANDBOX_EXPECTED_SECONDS = 30

/** ElevenLabs' words for a key it refuses (a 401). */
export const ELEVENLABS_SANDBOX_AUTH_MESSAGE = "Invalid API key."

/**
 * What a dubbing start comes to, in the words of the live adapter's failures (elevenlabs-failure.policy.ts): `completes` a job is started
 * and later done; `fails` started and later failed; `never` started and never finishes; `refused` an answered 4xx (`rejected`, nothing
 * sent); `auth_refused` the key is refused (nothing sent); `rate_limited` a 429 (nothing sent, a retry may pass); `timeout` no answer and
 * NOTHING started (`Unreachable`, proof unknown); `unknown` a 5xx AFTER the job was started (proof unknown: the job exists).
 */
export type ElevenLabsSandboxDubbingOutcome = "completes" | "fails" | "never" | "refused" | "auth_refused" | "rate_limited" | "timeout" | "unknown"

/** One dubbing case of the table: what its start comes to. */
export interface ElevenLabsSandboxDubbingCase {
    /** The catalogue case id. */
    readonly caseId: string
    /** What it comes to. */
    readonly outcome: ElevenLabsSandboxDubbingOutcome
}

/** The dubbing (`create`) cases, by id. */
export const ELEVENLABS_SANDBOX_DUBBINGS: ReadonlyArray<ElevenLabsSandboxDubbingCase> = [
    { caseId: "ELEVENLABS-6", outcome: "completes" },
    { caseId: "ELEVENLABS-7", outcome: "fails" },
    { caseId: "ELEVENLABS-20", outcome: "never" },
    { caseId: "ELEVENLABS-8", outcome: "refused" },
    { caseId: "ELEVENLABS-21", outcome: "auth_refused" },
    { caseId: "ELEVENLABS-22", outcome: "rate_limited" },
    { caseId: "ELEVENLABS-23", outcome: "timeout" },
    { caseId: "ELEVENLABS-9", outcome: "unknown" },
]

/** The case a dubbing start takes while the account's selector names none: a dub that completes. */
export const ELEVENLABS_SANDBOX_DEFAULT_DUBBING: ElevenLabsSandboxDubbingCase = { caseId: "ELEVENLABS-6", outcome: "completes" }

/** What a picked case of an operation that makes no state (voices, synthesize, get, file) fails with, by the live failure it is. */
export type ElevenLabsSandboxFault = "auth_refused" | "rate_limited" | "timeout" | "unknown" | "refused" | "not_found"

/** The faults the account can pick for each operation, by case id (the operation's own success case is its default and is no fault). */
export const ELEVENLABS_SANDBOX_FAULTS: Readonly<Record<string, Readonly<Record<string, ElevenLabsSandboxFault>>>> = {
    voices: { "ELEVENLABS-13": "auth_refused", "ELEVENLABS-14": "rate_limited", "ELEVENLABS-15": "timeout" },
    synthesize: {
        "ELEVENLABS-4": "not_found",
        "ELEVENLABS-5": "refused",
        "ELEVENLABS-16": "auth_refused",
        "ELEVENLABS-17": "rate_limited",
        "ELEVENLABS-18": "timeout",
        "ELEVENLABS-19": "unknown",
    },
    get: { "ELEVENLABS-10": "not_found", "ELEVENLABS-25": "auth_refused", "ELEVENLABS-26": "rate_limited", "ELEVENLABS-27": "timeout" },
    file: { "ELEVENLABS-12": "not_found", "ELEVENLABS-28": "auth_refused", "ELEVENLABS-29": "rate_limited", "ELEVENLABS-30": "timeout" },
}

/** The id of the dubbing a sandbox account starts as its start number `seq` + 1. */
export const elevenLabsSandboxDubbingId = (seq: number): string => `SBX-DUBBING-${String(seq + 1).padStart(6, "0")}`

/** The hardcoded catalogue of ElevenLabs' sandbox. */
export const ELEVENLABS_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: ELEVENLABS_SANDBOX_PROVIDER,
    cases: [
        {
            id: "ELEVENLABS-1",
            label: "The voice list: the three fixed voices, paged by the page size with a next-page token",
            operation: "voices",
            outcome: "ok",
            default: true,
        },
        {
            id: "ELEVENLABS-2",
            label: "A voice search the catalogue names (Rachel, narration) finds its voices; any other search finds none",
            operation: "voices",
            outcome: "ok",
        },
        { id: "ELEVENLABS-13", label: "The voice list refused for the key (401): auth_refused, nothing listed", operation: "voices", outcome: "refused" },
        { id: "ELEVENLABS-14", label: "The voice list answered 429: the live adapter's rate-limit error, a retry may pass", operation: "voices", outcome: "transient" },
        { id: "ELEVENLABS-15", label: "The voice list gets no answer (timeout): the live adapter's `Unreachable`", operation: "voices", outcome: "timeout" },
        {
            id: "ELEVENLABS-3",
            label: "Speech of a voice the catalogue holds: a clip of fixed bytes (audio/mpeg) behind a speech handle",
            operation: "synthesize",
            outcome: "ok",
            default: true,
        },
        {
            id: "ELEVENLABS-5",
            label: "Speech refused for a spent quota (rejected, nothing sent): picked by the account, no magic voice id",
            operation: "synthesize",
            outcome: "refused",
        },
        {
            id: "ELEVENLABS-4",
            label: "Speech of a voice the account does not hold: not_found refusal (also what the default answers for a voice id the catalogue does not hold)",
            operation: "synthesize",
            outcome: "refused",
        },
        { id: "ELEVENLABS-16", label: "Speech refused for the key (401): auth_refused, nothing sent", operation: "synthesize", outcome: "refused" },
        { id: "ELEVENLABS-17", label: "Speech answered 429: the live adapter's rate-limit error proving not_sent, a retry may pass", operation: "synthesize", outcome: "transient" },
        {
            id: "ELEVENLABS-18",
            label: "Speech gets no answer (timeout): the live adapter's `Unreachable` proving unknown; no clip",
            operation: "synthesize",
            outcome: "timeout",
        },
        {
            id: "ELEVENLABS-19",
            label: "Speech answered 5xx: the live adapter's failure proving unknown; the clip may have been made and charged, NIVO cannot read it (the speech makes no record)",
            operation: "synthesize",
            outcome: "timeout",
        },
        {
            id: "ELEVENLABS-6",
            label: "A dubbing is accepted and later completes: reads see dubbing, then dubbed with one file per target language",
            operation: "create",
            outcome: "ok",
            default: true,
        },
        { id: "ELEVENLABS-7", label: "A dubbing is accepted and later fails: reads end failed with ElevenLabs' words", operation: "create", outcome: "ok" },
        {
            id: "ELEVENLABS-20",
            label: "A dubbing is accepted and never finishes: reads see dubbing for ever (the run's deadline reads it and ends the wait)",
            operation: "create",
            outcome: "ok",
        },
        { id: "ELEVENLABS-8", label: "A dubbing is refused at start (source unusable): rejected, nothing sent", operation: "create", outcome: "refused" },
        { id: "ELEVENLABS-21", label: "A dubbing is refused at start because the key is refused (401): auth_refused, nothing sent", operation: "create", outcome: "refused" },
        {
            id: "ELEVENLABS-22",
            label: "A dubbing start answered 429: the live adapter's rate-limit error proving not_sent, no job exists, a retry may pass",
            operation: "create",
            outcome: "transient",
        },
        {
            id: "ELEVENLABS-23",
            label: "A dubbing start gets no answer (timeout): the live adapter's `Unreachable` proving unknown, but NOTHING was started: no job exists",
            operation: "create",
            outcome: "timeout",
        },
        {
            id: "ELEVENLABS-9",
            label: "A dubbing start ends in an unknown outcome (5xx): the job exists, the caller cannot know it",
            operation: "create",
            outcome: "timeout",
        },
        {
            id: "ELEVENLABS-24",
            label: "A dubbing read of a job the account started: the job as its life (chosen at start) shows it, one step per read",
            operation: "get",
            outcome: "ok",
            default: true,
        },
        {
            id: "ELEVENLABS-10",
            label: "A dubbing read of a job the account does not hold: not_found refusal (also what the default answers for an id never started)",
            operation: "get",
            outcome: "refused",
        },
        { id: "ELEVENLABS-25", label: "A dubbing read refused for the key (401): auth_refused, nothing read", operation: "get", outcome: "refused" },
        { id: "ELEVENLABS-26", label: "A dubbing read answered 429: the live adapter's rate-limit error, a retry may pass", operation: "get", outcome: "transient" },
        { id: "ELEVENLABS-27", label: "A dubbing read gets no answer (timeout): the live adapter's `Unreachable`", operation: "get", outcome: "timeout" },
        {
            id: "ELEVENLABS-11",
            label: "A dubbed language reopened by its handle (dubbing/<id>/<language>) of a job the account holds: fixed bytes",
            operation: "file",
            outcome: "ok",
            default: true,
        },
        {
            id: "ELEVENLABS-12",
            label: "A handle that is no dubbed language (a speech clip's handle) or of a job the account does not hold: not_found refusal (also what the default answers for such a handle)",
            operation: "file",
            outcome: "refused",
        },
        { id: "ELEVENLABS-28", label: "A dubbed-file fetch refused for the key (401): auth_refused, nothing fetched", operation: "file", outcome: "refused" },
        { id: "ELEVENLABS-29", label: "A dubbed-file fetch answered 429: the live adapter's rate-limit error, a retry may pass", operation: "file", outcome: "transient" },
        { id: "ELEVENLABS-30", label: "A dubbed-file fetch gets no answer (timeout): the live adapter's `Unreachable`", operation: "file", outcome: "timeout" },
    ],
}
