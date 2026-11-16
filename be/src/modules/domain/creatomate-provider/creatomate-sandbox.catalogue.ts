import { RENDER_COMPLETED, RENDER_DOOR_PATH, type RenderStatus } from "@modules/domain/video-compose"
import type { SandboxCatalogue, SandboxInboundCase, SandboxInput, SandboxInputField } from "@modules/domain/provider-sandbox"

/*
 * CREATOMATE'S SANDBOX CATALOGUE (owner ruling R60; SBX standard 2026-11-15): fixed named cases `CREATOMATE-<n>`, identical on every machine.
 * A start is answered by the account's NEXT CASE of `start` (the Sandbox page / `setSandboxNextCase`, sticky); with none picked the default
 * CREATOMATE-1 answers (a render that completes). A render's WHOLE LIFE (accepted -> progress -> done / failed / never finishes) is chosen at
 * START by the case and lived out by the status reads from the account's state. A status read is answered by the render's kept life, unless
 * the account picked a case of `statusOf` (not found, key refused, 429, no answer). The shapes of the answers are Creatomate's own: a render
 * object (`id`, `status`, `url`, `error_message`) is what a start, a status read and the webhook share (creatomate.client.ts
 * `creatomateRenderOf`; https://creatomate.com/docs/api/reference/what-is-a-render).
 */

/** The provider key of the catalogue. */
export const CREATOMATE_SANDBOX_PROVIDER = "creatomate"

/**
 * The segment a sandbox webhook path carries where a live one carries the connection's webhook secret. A sandbox account holds no secret:
 * its call is proven by the sandbox key header (`x-nivo-sandbox-key`) the Sandbox page or the test adds, never by this segment.
 */
export const CREATOMATE_SANDBOX_PATH_TOKEN = "sandbox"

/** The finished video every completing render ends at. */
export const CREATOMATE_SANDBOX_OUTPUT_URL = "https://sandbox.nivo.test/creatomate/renders/finished.mp4"

/** The words Creatomate's failed render carries in `error_message`. */
export const CREATOMATE_SANDBOX_FAILED_MESSAGE = "An element source could not be downloaded."

/** Creatomate's hint when an account is out of credits (a 402: an answered refusal, `rejected`). */
export const CREATOMATE_SANDBOX_NO_CREDITS_HINT = "Your account has run out of credits."

/** Creatomate's hint for a render id the account does not hold (a 404). */
export const CREATOMATE_SANDBOX_NOT_FOUND_HINT = "Render not found."

/** Creatomate's hint for a key it refuses (a 401). */
export const CREATOMATE_SANDBOX_AUTH_HINT = "Invalid API key."

/**
 * What a start comes to, in the words of the live adapter's failures (creatomate-failure.policy.ts): `accepted` a render is started;
 * `refused` an answered 4xx such as 402 (`rejected`, nothing sent); `auth_refused` the key is refused (401, nothing sent);
 * `rate_limited` a 429 (nothing sent, a retry may pass); `timeout` no answer and NOTHING started (`Unreachable`, proof unknown);
 * `unknown` a 5xx or no answer AFTER the render was started (proof unknown: the render exists, the caller cannot know it).
 */
export type CreatomateSandboxStartOutcome = "accepted" | "refused" | "auth_refused" | "rate_limited" | "timeout" | "unknown"

/** One start case of the table: what the start comes to and the life of the render it started. */
export interface CreatomateSandboxStartCase {
    /** The catalogue case id. */
    readonly caseId: string
    /** What the start comes to. */
    readonly outcome: CreatomateSandboxStartOutcome
    /** The statuses successive status reads see (the last one HOLDS: a list ending in `rendering` never finishes); empty when no render starts. */
    readonly polls: ReadonlyArray<RenderStatus>
}

/** The life of a render that completes: queued (planned), rendering, then done. */
const COMPLETES: ReadonlyArray<RenderStatus> = ["queued", "rendering", "done"]

/** The start cases, by id. A status read sees queued (planned), then rendering, then the end. */
export const CREATOMATE_SANDBOX_STARTS: ReadonlyArray<CreatomateSandboxStartCase> = [
    { caseId: "CREATOMATE-1", outcome: "accepted", polls: COMPLETES },
    { caseId: "CREATOMATE-2", outcome: "accepted", polls: ["queued", "rendering", "failed"] },
    { caseId: "CREATOMATE-8", outcome: "accepted", polls: ["queued", "rendering"] },
    { caseId: "CREATOMATE-3", outcome: "refused", polls: [] },
    { caseId: "CREATOMATE-9", outcome: "auth_refused", polls: [] },
    { caseId: "CREATOMATE-10", outcome: "rate_limited", polls: [] },
    { caseId: "CREATOMATE-11", outcome: "timeout", polls: [] },
    { caseId: "CREATOMATE-4", outcome: "unknown", polls: COMPLETES },
]

/** The case a start takes while the account's selector names none: a render that completes. */
export const CREATOMATE_SANDBOX_DEFAULT_START: CreatomateSandboxStartCase = { caseId: "CREATOMATE-1", outcome: "accepted", polls: COMPLETES }

/** The case ids of the status read (`statusOf`) that fail the read itself, by what the read comes to. */
export const CREATOMATE_SANDBOX_READS = {
    notFound: "CREATOMATE-5",
    authRefused: "CREATOMATE-12",
    rateLimited: "CREATOMATE-13",
    timeout: "CREATOMATE-14",
} as const

/** The render id the callback of CREATOMATE-18 names: a render the account never started. */
export const CREATOMATE_SANDBOX_NEVER_STARTED_ID = "SBX-CREATOMATE-NEVER-STARTED"

/** The id of the render a sandbox account starts as its start number `seq` + 1: the ids the inbound cases name. */
export const creatomateSandboxRenderId = (seq: number): string => `SBX-CREATOMATE-${String(seq + 1).padStart(6, "0")}`

/** The path of Creatomate's render webhook on NIVO for one account: the render door of the provider (the sandbox key header proves the call). */
const webhookPath = (connectionId: string): string =>
    `${RENDER_DOOR_PATH}/${CREATOMATE_SANDBOX_PROVIDER}/${encodeURIComponent(connectionId)}/${CREATOMATE_SANDBOX_PATH_TOKEN}`

/** The one input of a render webhook case: the id of the render the account started earlier (its start answered it). */
const renderInputs = (example: string): ReadonlyArray<SandboxInputField> => [
    { name: "renderId", label: "Mã render đã tạo / Render id the account started", kind: "text", example },
]

/** The render id an input names, or the case's example when none is given. */
const renderIdOf = (input: SandboxInput, example: string): string => (typeof input.renderId === "string" && input.renderId !== "" ? input.renderId : example)

/** A render webhook case of Creatomate: the body of the render named by the input, built by `bodyOf`. */
const webhookCase = (example: string, bodyOf: (renderId: string) => unknown): SandboxInboundCase => ({
    trigger: RENDER_COMPLETED,
    path: webhookPath,
    inputs: renderInputs(example),
    eventsOf: async (input: SandboxInput) => [{ body: bodyOf(renderIdOf(input, example)) }],
})

/** The hardcoded catalogue of Creatomate's sandbox. */
export const CREATOMATE_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: CREATOMATE_SANDBOX_PROVIDER,
    cases: [
        {
            id: "CREATOMATE-1",
            label: "A render is accepted (planned) and later completes: status reads see planned, rendering, then succeeded with its video address",
            operation: "start",
            outcome: "ok",
            default: true,
        },
        {
            id: "CREATOMATE-2",
            label: "A render is accepted and later fails: status reads end at failed with its error_message",
            operation: "start",
            outcome: "ok",
        },
        {
            id: "CREATOMATE-8",
            label: "A render is accepted and never finishes: status reads see planned, then rendering for ever (the run's deadline reads it and ends the wait)",
            operation: "start",
            outcome: "ok",
        },
        { id: "CREATOMATE-3", label: "A render is refused at start for no credits (402): rejected, nothing sent", operation: "start", outcome: "refused" },
        { id: "CREATOMATE-9", label: "A render is refused at start because the key is refused (401): auth_refused, nothing sent", operation: "start", outcome: "refused" },
        {
            id: "CREATOMATE-10",
            label: "A render start is answered 429 (rate limit): the live adapter's rate-limit error proving not_sent, no render exists, a retry may pass",
            operation: "start",
            outcome: "transient",
        },
        {
            id: "CREATOMATE-11",
            label: "A render start gets no answer (timeout): the live adapter's `Unreachable` proving unknown, but NOTHING was started: no render exists",
            operation: "start",
            outcome: "timeout",
        },
        {
            id: "CREATOMATE-4",
            label: "A render start ends in an unknown outcome (5xx): the render exists, the caller cannot know it",
            operation: "start",
            outcome: "timeout",
        },
        {
            id: "CREATOMATE-15",
            label: "A status read of a render the account started: the render as its life (chosen at start) shows it, one step per read",
            operation: "statusOf",
            outcome: "ok",
            default: true,
        },
        {
            id: "CREATOMATE-5",
            label: "A status read of a render the account does not hold: not_found refusal (also what the default answers for an id never started)",
            operation: "statusOf",
            outcome: "refused",
        },
        { id: "CREATOMATE-12", label: "A status read refused for the key (401): auth_refused, nothing read", operation: "statusOf", outcome: "refused" },
        { id: "CREATOMATE-13", label: "A status read answered 429 (rate limit): the live adapter's rate-limit error, a retry may pass", operation: "statusOf", outcome: "transient" },
        { id: "CREATOMATE-14", label: "A status read gets no answer (timeout): the live adapter's `Unreachable`", operation: "statusOf", outcome: "timeout" },
        {
            id: "CREATOMATE-6",
            label: "The webhook reports a render that succeeded (the render id named, by default the first of the account): done with its video address",
            inbound: webhookCase(creatomateSandboxRenderId(0), (id) => ({ id, status: "succeeded", url: CREATOMATE_SANDBOX_OUTPUT_URL, error_message: null })),
        },
        {
            id: "CREATOMATE-7",
            label: "The webhook reports a render that failed (the render id named, by default the second of the account): failed with its error_message",
            inbound: webhookCase(creatomateSandboxRenderId(1), (id) => ({ id, status: "failed", url: null, error_message: CREATOMATE_SANDBOX_FAILED_MESSAGE })),
        },
        {
            id: "CREATOMATE-16",
            label: "The webhook carries a render still in progress (status rendering, no video): the door keeps nothing (only an end is a finished render)",
            inbound: webhookCase(creatomateSandboxRenderId(0), (id) => ({ id, status: "rendering", url: null, error_message: null })),
        },
        {
            id: "CREATOMATE-17",
            label: "The webhook says succeeded but carries no https video address: the live mapper reads no finished render, the door keeps nothing",
            inbound: webhookCase(creatomateSandboxRenderId(0), (id) => ({ id, status: "succeeded", url: null, error_message: null })),
        },
        {
            id: "CREATOMATE-18",
            label: "The webhook reports a render the account never started (a fixed render id nobody asked for): the door keeps it once and no waiting run matches it",
            inbound: {
                trigger: RENDER_COMPLETED,
                path: webhookPath,
                inputs: [],
                eventsOf: async () => [
                    { body: { id: CREATOMATE_SANDBOX_NEVER_STARTED_ID, status: "succeeded", url: CREATOMATE_SANDBOX_OUTPUT_URL, error_message: null } },
                ],
            },
        },
    ],
}
