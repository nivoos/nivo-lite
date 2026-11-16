import { RENDER_COMPLETED, RENDER_DOOR_PATH, type RenderStatus } from "@modules/domain/video-compose"
import type { SandboxCatalogue, SandboxInboundCase, SandboxInput, SandboxInputField } from "@modules/domain/provider-sandbox"

/*
 * JSON2VIDEO'S SANDBOX CATALOGUE (owner ruling R60; SBX standard 2026-11-15): fixed named cases `JSON2VIDEO-<n>`, identical on every machine.
 * A start is answered by the account's NEXT CASE of `start` (the Sandbox page / `setSandboxNextCase`, sticky); with none picked the default
 * JSON2VIDEO-1 answers (a render that completes). A render's WHOLE LIFE (accepted -> progress -> done / failed / never finishes / timed
 * out) is chosen at START by the case and lived out by the status reads from the account's state; a status read is answered by the
 * render's kept life, unless the account picked a case of `statusOf`. A status read walks JSON2Video's own states (pending, running, then
 * done or error); the webhook body is JSON2Video's flat one (no event name: `success`, `project`, then `url` or `error`; the dashboard's
 * Test sends `test: true`: json2video-status.policy.ts `completionOf`). The refusal and not-found words are representative: the live
 * adapter carries whatever words JSON2Video answered.
 */

/** The provider key of the catalogue. */
export const JSON2VIDEO_SANDBOX_PROVIDER = "json2video"

/**
 * The segment a sandbox webhook path carries where a live one carries the connection's webhook secret. A sandbox account holds no secret:
 * its call is proven by the sandbox key header (`x-nivo-sandbox-key`) the Sandbox page or the test adds, never by this segment.
 */
export const JSON2VIDEO_SANDBOX_PATH_TOKEN = "sandbox"

/** The finished video every completing render ends at. */
export const JSON2VIDEO_SANDBOX_OUTPUT_URL = "https://sandbox.nivo.test/json2video/renders/finished.mp4"

/** The words JSON2Video's failed render carries (`message` of its status read, `error` of its webhook). */
export const JSON2VIDEO_SANDBOX_FAILED_MESSAGE = "A video source could not be downloaded."

/** JSON2Video's words when an account is out of credits (a 402: an answered refusal, `rejected`). */
export const JSON2VIDEO_SANDBOX_NO_CREDITS_MESSAGE = "Not enough credits to render this movie."

/** JSON2Video's words for a project the account does not hold (a 404). */
export const JSON2VIDEO_SANDBOX_NOT_FOUND_MESSAGE = "Project not found."

/** JSON2Video's words for a key it refuses (a 401). */
export const JSON2VIDEO_SANDBOX_AUTH_MESSAGE = "Invalid API key."

/**
 * What a start comes to, in the words of the live adapter's failures (json2video-failure.policy.ts): `accepted` a render is started;
 * `refused` an answered 4xx such as 402 (`rejected`, nothing sent); `auth_refused` the key is refused (401, nothing sent);
 * `rate_limited` a 429 (nothing sent, a retry may pass); `timeout` no answer and NOTHING started (`Unreachable`, proof unknown);
 * `unknown` a 5xx or no answer AFTER the render was started (proof unknown: the render exists, the caller cannot know it).
 */
export type Json2VideoSandboxStartOutcome = "accepted" | "refused" | "auth_refused" | "rate_limited" | "timeout" | "unknown"

/** One start case of the table: what the start comes to and the life of the render it started. */
export interface Json2VideoSandboxStartCase {
    /** The catalogue case id. */
    readonly caseId: string
    /** What the start comes to. */
    readonly outcome: Json2VideoSandboxStartOutcome
    /** The statuses successive status reads see (the last one HOLDS: a list ending in `rendering` never finishes); empty when no render starts. */
    readonly polls: ReadonlyArray<RenderStatus>
    /** When the life ends in `failed`: that it is the client's 15-minute timeout (JSON2Video's `timeout`), whose words are not the provider's own error. */
    readonly timedOut?: true | undefined
}

/** The life of a render that completes: queued (pending), rendering (running), then done. */
const COMPLETES: ReadonlyArray<RenderStatus> = ["queued", "rendering", "done"]

/** The start cases, by id. A status read sees queued (pending), then rendering (running), then the end. */
export const JSON2VIDEO_SANDBOX_STARTS: ReadonlyArray<Json2VideoSandboxStartCase> = [
    { caseId: "JSON2VIDEO-1", outcome: "accepted", polls: COMPLETES },
    { caseId: "JSON2VIDEO-2", outcome: "accepted", polls: ["queued", "rendering", "failed"] },
    { caseId: "JSON2VIDEO-9", outcome: "accepted", polls: ["queued", "rendering"] },
    { caseId: "JSON2VIDEO-19", outcome: "accepted", polls: ["queued", "rendering", "failed"], timedOut: true },
    { caseId: "JSON2VIDEO-3", outcome: "refused", polls: [] },
    { caseId: "JSON2VIDEO-10", outcome: "auth_refused", polls: [] },
    { caseId: "JSON2VIDEO-11", outcome: "rate_limited", polls: [] },
    { caseId: "JSON2VIDEO-12", outcome: "timeout", polls: [] },
    { caseId: "JSON2VIDEO-4", outcome: "unknown", polls: COMPLETES },
]

/** The case a start takes while the account's selector names none: a render that completes. */
export const JSON2VIDEO_SANDBOX_DEFAULT_START: Json2VideoSandboxStartCase = { caseId: "JSON2VIDEO-1", outcome: "accepted", polls: COMPLETES }

/** The case ids of the status read (`statusOf`) that fail the read itself, by what the read comes to. */
export const JSON2VIDEO_SANDBOX_READS = {
    notFound: "JSON2VIDEO-5",
    authRefused: "JSON2VIDEO-14",
    rateLimited: "JSON2VIDEO-15",
    timeout: "JSON2VIDEO-16",
} as const

/** The render id the callback of JSON2VIDEO-18 names: a render the account never started. */
export const JSON2VIDEO_SANDBOX_NEVER_STARTED_ID = "SBX-JSON2VIDEO-NEVER-STARTED"

/** The id (JSON2Video's `project`) of the render a sandbox account starts as its start number `seq` + 1: the ids the inbound cases name. */
export const json2videoSandboxRenderId = (seq: number): string => `SBX-JSON2VIDEO-${String(seq + 1).padStart(6, "0")}`

/** The path of JSON2Video's render webhook on NIVO for one account: the render door of the provider (the sandbox key header proves the call). */
const webhookPath = (connectionId: string): string =>
    `${RENDER_DOOR_PATH}/${JSON2VIDEO_SANDBOX_PROVIDER}/${encodeURIComponent(connectionId)}/${JSON2VIDEO_SANDBOX_PATH_TOKEN}`

/** The one input of a render webhook case: the id of the render the account started earlier (its start answered it). */
const renderInputs = (example: string): ReadonlyArray<SandboxInputField> => [
    { name: "renderId", label: "Mã render đã tạo / Render id the account started", kind: "text", example },
]

/** The render id an input names, or the case's example when none is given. */
const renderIdOf = (input: SandboxInput, example: string): string => (typeof input.renderId === "string" && input.renderId !== "" ? input.renderId : example)

/** A render webhook case of JSON2Video: the body of the render named by the input, built by `bodyOf`. */
const webhookCase = (example: string, bodyOf: (renderId: string) => unknown): SandboxInboundCase => ({
    trigger: RENDER_COMPLETED,
    path: webhookPath,
    inputs: renderInputs(example),
    eventsOf: async (input: SandboxInput) => [{ body: bodyOf(renderIdOf(input, example)) }],
})

/** The hardcoded catalogue of JSON2Video's sandbox. */
export const JSON2VIDEO_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: JSON2VIDEO_SANDBOX_PROVIDER,
    cases: [
        {
            id: "JSON2VIDEO-1",
            label: "A render is accepted (pending) and later completes: status reads see pending, running, then done with its video address",
            operation: "start",
            outcome: "ok",
            default: true,
        },
        { id: "JSON2VIDEO-2", label: "A render is accepted and later fails: status reads end at error with its message", operation: "start", outcome: "ok" },
        {
            id: "JSON2VIDEO-9",
            label: "A render is accepted and never finishes: status reads see pending, then running for ever (the run's deadline reads it and ends the wait)",
            operation: "start",
            outcome: "ok",
        },
        {
            id: "JSON2VIDEO-19",
            label: "A render is accepted and runs past 15 minutes: the live status mapper fails it with JSON2Video's timeout words (movies-status: the client treats it as fatal)",
            operation: "start",
            outcome: "ok",
        },
        { id: "JSON2VIDEO-3", label: "A render is refused at start for no credits (402): rejected, nothing sent", operation: "start", outcome: "refused" },
        { id: "JSON2VIDEO-10", label: "A render is refused at start because the key is refused (401): auth_refused, nothing sent", operation: "start", outcome: "refused" },
        {
            id: "JSON2VIDEO-11",
            label: "A render start is answered 429 (rate limit): the live adapter's rate-limit error proving not_sent, no render exists, a retry may pass",
            operation: "start",
            outcome: "transient",
        },
        {
            id: "JSON2VIDEO-12",
            label: "A render start gets no answer (timeout): the live adapter's `Unreachable` proving unknown, but NOTHING was started: no render exists",
            operation: "start",
            outcome: "timeout",
        },
        {
            id: "JSON2VIDEO-4",
            label: "A render start ends in an unknown outcome (5xx): the render exists, the caller cannot know it",
            operation: "start",
            outcome: "timeout",
        },
        {
            id: "JSON2VIDEO-13",
            label: "A status read of a render the account started: the render as its life (chosen at start) shows it, one step per read",
            operation: "statusOf",
            outcome: "ok",
            default: true,
        },
        {
            id: "JSON2VIDEO-5",
            label: "A status read of a render the account does not hold: not_found refusal (also what the default answers for an id never started)",
            operation: "statusOf",
            outcome: "refused",
        },
        { id: "JSON2VIDEO-14", label: "A status read refused for the key (401): auth_refused, nothing read", operation: "statusOf", outcome: "refused" },
        { id: "JSON2VIDEO-15", label: "A status read answered 429 (rate limit): the live adapter's rate-limit error, a retry may pass", operation: "statusOf", outcome: "transient" },
        { id: "JSON2VIDEO-16", label: "A status read gets no answer (timeout): the live adapter's `Unreachable`", operation: "statusOf", outcome: "timeout" },
        {
            id: "JSON2VIDEO-6",
            label: "The webhook reports a render that succeeded (the project named, by default the first render of the account): done with its video address",
            inbound: webhookCase(json2videoSandboxRenderId(0), (project) => ({ success: true, project, url: JSON2VIDEO_SANDBOX_OUTPUT_URL })),
        },
        {
            id: "JSON2VIDEO-7",
            label: "The webhook reports a render that failed (the project named, by default the second render of the account): failed with its error",
            inbound: webhookCase(json2videoSandboxRenderId(1), (project) => ({ success: false, project, error: JSON2VIDEO_SANDBOX_FAILED_MESSAGE })),
        },
        {
            id: "JSON2VIDEO-8",
            label: "The dashboard's test ping (no finished render): the door keeps nothing",
            inbound: {
                trigger: RENDER_COMPLETED,
                path: webhookPath,
                inputs: [],
                eventsOf: async () => [{ body: { test: true, success: true, project: json2videoSandboxRenderId(0), url: JSON2VIDEO_SANDBOX_OUTPUT_URL } }],
            },
        },
        {
            id: "JSON2VIDEO-17",
            label: "The webhook says success but carries no https video address: the live mapper reads no finished render, the door keeps nothing",
            inbound: webhookCase(json2videoSandboxRenderId(0), (project) => ({ success: true, project, url: null })),
        },
        {
            id: "JSON2VIDEO-18",
            label: "The webhook reports a render the account never started (a fixed project nobody asked for): the door keeps it once and no waiting run matches it",
            inbound: {
                trigger: RENDER_COMPLETED,
                path: webhookPath,
                inputs: [],
                eventsOf: async () => [{ body: { success: true, project: JSON2VIDEO_SANDBOX_NEVER_STARTED_ID, url: JSON2VIDEO_SANDBOX_OUTPUT_URL } }],
            },
        },
    ],
}
