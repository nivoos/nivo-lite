import type { SandboxCatalogue } from "@modules/domain/provider-sandbox"

/*
 * VEO'S SANDBOX CATALOGUE (owner ruling R60; SBX standard 2026-11-15): fixed named cases `VEO-<n>`, identical on every machine, for the two
 * ports Veo registers: video generation (a long-running operation started, then POLLED: Veo sends no webhook to NIVO, so the catalogue has
 * no inbound case) and the files it holds (a generated video reopened by its URI). A generation is answered by the account's NEXT CASE of
 * `start` (the Sandbox page / `setSandboxNextCase`, sticky; default VEO-1, a video that completes) which chooses the operation's WHOLE
 * LIFE (completes, fails, blocked, never finishes) lived out by the reads of `get` from the account's state; a read or a file fetch is
 * failed by the case the account picked for `get` / `file`. The refusal words are representative: the live adapter carries whatever words
 * Google answered. Failures are the live adapter's (veo-failure.policy.ts), built from the client's own error.
 */

/** The provider key of the catalogue. */
export const VEO_SANDBOX_PROVIDER = "veo"

/**
 * What a start comes to, in the words of the live adapter's failures (veo-failure.policy.ts): `accepted` an operation is started;
 * `refused` an answered 4xx (`rejected`, nothing sent); `auth_refused` the key is refused (401/403, nothing sent); `rate_limited` a 429
 * RESOURCE_EXHAUSTED (nothing sent, a retry may pass); `timeout` no answer and NOTHING started (`Unreachable`, proof unknown); `unknown` a
 * 5xx or no answer AFTER the operation was started (proof unknown: the operation exists, the caller cannot know it).
 */
export type VeoSandboxStartOutcome = "accepted" | "refused" | "auth_refused" | "rate_limited" | "timeout" | "unknown"

/** What a finished generation holds: its video, an error, nothing (blocked by the provider's filters), or it never finishes. */
export type VeoSandboxEnd = "video" | "error" | "blocked" | "never"

/** One start case of the table: what the start comes to and how an accepted generation ends. */
export interface VeoSandboxCase {
    /** The catalogue case id. */
    readonly caseId: string
    /** What the start comes to. */
    readonly outcome: VeoSandboxStartOutcome
    /** How a generation that was accepted ends (`never`: it stays pending for ever). */
    readonly end: VeoSandboxEnd
}

/** The start cases, by id. */
export const VEO_SANDBOX_CASES: ReadonlyArray<VeoSandboxCase> = [
    { caseId: "VEO-1", outcome: "accepted", end: "video" },
    { caseId: "VEO-2", outcome: "accepted", end: "error" },
    { caseId: "VEO-3", outcome: "accepted", end: "blocked" },
    { caseId: "VEO-10", outcome: "accepted", end: "never" },
    { caseId: "VEO-4", outcome: "refused", end: "video" },
    { caseId: "VEO-11", outcome: "auth_refused", end: "video" },
    { caseId: "VEO-12", outcome: "rate_limited", end: "video" },
    { caseId: "VEO-13", outcome: "timeout", end: "video" },
    { caseId: "VEO-5", outcome: "unknown", end: "video" },
]

/** The case a start takes while the account's selector names none: a video that completes. */
export const VEO_SANDBOX_DEFAULT_START: VeoSandboxCase = { caseId: "VEO-1", outcome: "accepted", end: "video" }

/** The start case that is the no-model refusal (the account's selector may name it even when a model is set). */
export const VEO_SANDBOX_NO_MODEL_CASE = "VEO-6"

/** The case ids of the operation read (`get`) that fail the read itself, by what the read comes to. */
export const VEO_SANDBOX_READS = {
    notFound: "VEO-7",
    authRefused: "VEO-15",
    rateLimited: "VEO-16",
    timeout: "VEO-17",
} as const

/** The case ids of the video fetch (`file`) that fail the fetch itself, by what the fetch comes to. */
export const VEO_SANDBOX_FILES = {
    notFound: "VEO-9",
    authRefused: "VEO-18",
    rateLimited: "VEO-19",
    timeout: "VEO-20",
} as const

/** How many status reads a running generation takes before it ends (it is not done on the first N reads). */
export const VEO_SANDBOX_PENDING_READS = 2

/** The error a failed generation ends with: Google's code and words. */
export const VEO_SANDBOX_FAILED_ERROR: { readonly code: number; readonly message: string } = {
    code: 3,
    message: "The prompt could not be processed.",
}

/** Google's words when the key is refused (a 403 PERMISSION_DENIED: `auth_refused`). */
export const VEO_SANDBOX_AUTH_MESSAGE = "API key not valid. Please pass a valid API key."

/** Google's words when a prompt is refused at start (a 400: `rejected`). */
export const VEO_SANDBOX_REJECTED_MESSAGE = "Invalid prompt."

/** Google's words for an operation the account does not hold (a 404). */
export const VEO_SANDBOX_JOB_NOT_FOUND_MESSAGE = "Operation not found."

/** Google's words for a video file the account was never answered (a 404). */
export const VEO_SANDBOX_FILE_NOT_FOUND_MESSAGE = "File not found."

/** The words a start with no model (neither the request's nor the account's) is refused with, as the live adapter does. */
export const VEO_SANDBOX_NO_MODEL_DETAIL = "model"

/** The media type of every generated video. */
export const VEO_SANDBOX_VIDEO_MIME = "video/mp4"

/** The name of an operation a sandbox account starts as its start number `seq` + 1, on one model. */
export const veoSandboxJobName = (model: string, seq: number): string => `models/${model}/operations/SBX-VEO-${String(seq + 1).padStart(6, "0")}`

/** The URI of the video a job (by its operation name) generated. */
export const veoSandboxVideoUri = (jobName: string): string => `https://sandbox.nivo.test/veo/files/${jobName.slice(jobName.lastIndexOf("/") + 1)}.mp4`

/** The bytes of a generated video: fixed, naming its URI. */
export const veoSandboxVideoBytesOf = (uri: string): Buffer => Buffer.from(`SBX-VIDEO|${uri}`, "utf8")

/** The hardcoded catalogue of Veo's sandbox. */
export const VEO_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: VEO_SANDBOX_PROVIDER,
    cases: [
        {
            id: "VEO-1",
            label: "A generation is accepted and later completes: reads see pending twice, then done with one video",
            operation: "start",
            outcome: "ok",
            default: true,
        },
        { id: "VEO-2", label: "A generation is accepted and later fails: the read ends failed with Google's code and words", operation: "start", outcome: "ok" },
        { id: "VEO-3", label: "A generation is accepted and ends done with no video (blocked by the provider's filters)", operation: "start", outcome: "ok" },
        {
            id: "VEO-10",
            label: "A generation is accepted and never finishes: reads see pending for ever (the run's deadline reads it and ends the wait)",
            operation: "start",
            outcome: "ok",
        },
        { id: "VEO-4", label: "A prompt is refused at start (400): rejected, nothing sent", operation: "start", outcome: "refused" },
        {
            id: "VEO-6",
            label: "A start naming no model (neither the request's nor the account's meta.model): rejected, nothing sent (also what the default answers for such a request)",
            operation: "start",
            outcome: "refused",
        },
        { id: "VEO-11", label: "A generation is refused at start because the key is refused (403): auth_refused, nothing sent", operation: "start", outcome: "refused" },
        {
            id: "VEO-12",
            label: "A generation start is answered 429 (RESOURCE_EXHAUSTED): the live adapter's rate-limit error proving not_sent, no operation exists, a retry may pass",
            operation: "start",
            outcome: "transient",
        },
        {
            id: "VEO-13",
            label: "A generation start gets no answer (timeout): the live adapter's `Unreachable` proving unknown, but NOTHING was started: no operation exists",
            operation: "start",
            outcome: "timeout",
        },
        {
            id: "VEO-5",
            label: "A generation start ends in an unknown outcome (5xx): the operation exists, the caller cannot know it",
            operation: "start",
            outcome: "timeout",
        },
        {
            id: "VEO-14",
            label: "A read of an operation the account started: the operation as its life (chosen at start) shows it, one step per read",
            operation: "get",
            outcome: "ok",
            default: true,
        },
        {
            id: "VEO-7",
            label: "A read of an operation the account does not hold: not_found refusal (also what the default answers for a name never started)",
            operation: "get",
            outcome: "refused",
        },
        { id: "VEO-15", label: "An operation read refused for the key (403): auth_refused, nothing read", operation: "get", outcome: "refused" },
        { id: "VEO-16", label: "An operation read answered 429 (RESOURCE_EXHAUSTED): the live adapter's rate-limit error, a retry may pass", operation: "get", outcome: "transient" },
        { id: "VEO-17", label: "An operation read gets no answer (timeout): the live adapter's `Unreachable`", operation: "get", outcome: "timeout" },
        {
            id: "VEO-8",
            label: "A video reopened by its URI after a read answered it: fixed bytes (video/mp4)",
            operation: "file",
            outcome: "ok",
            default: true,
        },
        {
            id: "VEO-9",
            label: "A video URI no read of the account answered: not_found refusal (also what the default answers for such a URI; the video Google keeps only 2 days)",
            operation: "file",
            outcome: "refused",
        },
        { id: "VEO-18", label: "A video fetch refused for the key (403): auth_refused, nothing fetched", operation: "file", outcome: "refused" },
        { id: "VEO-19", label: "A video fetch answered 429 (RESOURCE_EXHAUSTED): the live adapter's rate-limit error, a retry may pass", operation: "file", outcome: "transient" },
        { id: "VEO-20", label: "A video fetch gets no answer (timeout): the live adapter's `Unreachable`", operation: "file", outcome: "timeout" },
    ],
}
