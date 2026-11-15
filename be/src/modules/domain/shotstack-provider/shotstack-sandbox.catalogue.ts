import { RENDER_COMPLETED, RENDER_DOOR_PATH, type RenderStatus } from "@modules/domain/video-compose"
import type { SandboxCatalogue, SandboxInboundCase, SandboxInput, SandboxInputField } from "@modules/domain/provider-sandbox"

/*
 * SHOTSTACK'S SANDBOX CATALOGUE (owner ruling R60; SBX standard 2026-11-15): fixed named cases `SHOTSTACK-<n>`, identical on every machine.
 * A start is answered by the account's NEXT CASE of `start` (the Sandbox page / `setSandboxNextCase`, sticky); with none picked the default
 * SHOTSTACK-1 answers (a render that completes). A render's WHOLE LIFE (accepted -> progress -> done / failed / never finishes) is chosen
 * at START by the case and lived out by the status reads from the account's state; a status read is answered by the render's kept life,
 * unless the account picked a case of `statusOf`. A status read walks Shotstack's own states (queued, fetching, rendering, saving) before
 * the end; the webhook body is Shotstack's render callback (`type` "edit", `action` "render", `id`, `owner`, `status`, `url`, `error`,
 * `completed`: shotstack-callback.policy.ts `shotstackCompletionOf`). The refusal and not-found words are representative: the live
 * adapter carries whatever words Shotstack answered.
 */

/** The provider key of the catalogue. */
export const SHOTSTACK_SANDBOX_PROVIDER = "shotstack"

/**
 * The segment a sandbox webhook path carries where a live one carries the connection's webhook secret. A sandbox account holds no secret:
 * its call is proven by the sandbox key header (`x-nivo-sandbox-key`) the Sandbox page or the test adds, never by this segment.
 */
export const SHOTSTACK_SANDBOX_PATH_TOKEN = "sandbox"

/** The finished video every completing render ends at. */
export const SHOTSTACK_SANDBOX_OUTPUT_URL = "https://sandbox.nivo.test/shotstack/renders/finished.mp4"

/** The reason Shotstack's failed render carries in `error`. */
export const SHOTSTACK_SANDBOX_FAILED_MESSAGE = "Unable to fetch asset: the video source answered 404."

/** Shotstack's words when it refuses an Edit at start (a 400: an answered refusal, `rejected`). */
export const SHOTSTACK_SANDBOX_REJECTED_MESSAGE = "Bad Request: the edit timeline is not valid."

/** Shotstack's words for a render id the account does not hold (a 404). */
export const SHOTSTACK_SANDBOX_NOT_FOUND_MESSAGE = "Not Found"

/** The owner id Shotstack's callback names (fixed). */
export const SHOTSTACK_SANDBOX_OWNER = "sbx-shotstack-owner"

/** The time Shotstack's callback names as completed (fixed). */
export const SHOTSTACK_SANDBOX_COMPLETED_AT = "2026-11-14T00:00:00.000Z"

/** Shotstack's words for a key it refuses (a 401). */
export const SHOTSTACK_SANDBOX_AUTH_MESSAGE = "Unauthorized: the API key is not valid."

/**
 * What a start comes to, in the words of the live adapter's failures (shotstack-failure.policy.ts): `accepted` a render is started;
 * `refused` an answered 4xx (`rejected`, nothing sent); `auth_refused` the key is refused (401, nothing sent); `rate_limited` a 429
 * (nothing sent, a retry may pass); `timeout` no answer and NOTHING started (`Unreachable`, proof unknown); `unknown` a 5xx or no
 * answer AFTER the render was started (proof unknown: the render exists, the caller cannot know it).
 */
export type ShotstackSandboxStartOutcome = "accepted" | "refused" | "auth_refused" | "rate_limited" | "timeout" | "unknown"

/** One start case of the table: what the start comes to and the life of the render it started. */
export interface ShotstackSandboxStartCase {
    /** The catalogue case id. */
    readonly caseId: string
    /** What the start comes to. */
    readonly outcome: ShotstackSandboxStartOutcome
    /** The statuses successive status reads see (the last one HOLDS: a list ending in `rendering` never finishes); empty when no render starts. */
    readonly polls: ReadonlyArray<RenderStatus>
}

/** The life of a render that completes: queued, rendering (fetching, rendering, saving), then done. */
const COMPLETES: ReadonlyArray<RenderStatus> = ["queued", "rendering", "rendering", "done"]

/** The start cases, by id. A status read sees queued, then rendering, then the end. */
export const SHOTSTACK_SANDBOX_STARTS: ReadonlyArray<ShotstackSandboxStartCase> = [
    { caseId: "SHOTSTACK-1", outcome: "accepted", polls: COMPLETES },
    { caseId: "SHOTSTACK-2", outcome: "accepted", polls: ["queued", "rendering", "failed"] },
    { caseId: "SHOTSTACK-8", outcome: "accepted", polls: ["queued", "rendering"] },
    { caseId: "SHOTSTACK-3", outcome: "refused", polls: [] },
    { caseId: "SHOTSTACK-9", outcome: "auth_refused", polls: [] },
    { caseId: "SHOTSTACK-10", outcome: "rate_limited", polls: [] },
    { caseId: "SHOTSTACK-11", outcome: "timeout", polls: [] },
    { caseId: "SHOTSTACK-4", outcome: "unknown", polls: COMPLETES },
]

/** The case a start takes while the account's selector names none: a render that completes. */
export const SHOTSTACK_SANDBOX_DEFAULT_START: ShotstackSandboxStartCase = { caseId: "SHOTSTACK-1", outcome: "accepted", polls: COMPLETES }

/** The case ids of the status read (`statusOf`) that fail the read itself, by what the read comes to. */
export const SHOTSTACK_SANDBOX_READS = {
    notFound: "SHOTSTACK-5",
    authRefused: "SHOTSTACK-13",
    rateLimited: "SHOTSTACK-14",
    timeout: "SHOTSTACK-15",
} as const

/** The render id the callback of SHOTSTACK-18 names: a render the account never started. */
export const SHOTSTACK_SANDBOX_NEVER_STARTED_ID = "SBX-SHOTSTACK-NEVER-STARTED"

/** The id of the render a sandbox account starts as its start number `seq` + 1: the ids the inbound cases name. */
export const shotstackSandboxRenderId = (seq: number): string => `SBX-SHOTSTACK-${String(seq + 1).padStart(6, "0")}`

/** The path of Shotstack's render webhook on NIVO for one account: the render door of the provider (the sandbox key header proves the call). */
const webhookPath = (connectionId: string): string =>
    `${RENDER_DOOR_PATH}/${SHOTSTACK_SANDBOX_PROVIDER}/${encodeURIComponent(connectionId)}/${SHOTSTACK_SANDBOX_PATH_TOKEN}`

/** The one input of a render webhook case: the id of the render the account started earlier (its start answered it). */
const renderInputs = (example: string): ReadonlyArray<SandboxInputField> => [
    { name: "renderId", label: "Mã render đã tạo / Render id the account started", kind: "text", example },
]

/** The render id an input names, or the case's example when none is given. */
const renderIdOf = (input: SandboxInput, example: string): string => (typeof input.renderId === "string" && input.renderId !== "" ? input.renderId : example)

/** A render webhook case of Shotstack: the body of the render named by the input, built by `bodyOf`. */
const webhookCase = (example: string, bodyOf: (renderId: string) => unknown): SandboxInboundCase => ({
    trigger: RENDER_COMPLETED,
    path: webhookPath,
    inputs: renderInputs(example),
    eventsOf: async (input: SandboxInput) => [{ body: bodyOf(renderIdOf(input, example)) }],
})

/** The callback body of a render that is `done` (shotstack-callback.policy.ts: type edit, action render, https url). */
const doneBody = (id: string): Record<string, unknown> => ({
    type: "edit",
    action: "render",
    id,
    owner: SHOTSTACK_SANDBOX_OWNER,
    status: "done",
    url: SHOTSTACK_SANDBOX_OUTPUT_URL,
    error: null,
    completed: SHOTSTACK_SANDBOX_COMPLETED_AT,
})

/** The hardcoded catalogue of Shotstack's sandbox. */
export const SHOTSTACK_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: SHOTSTACK_SANDBOX_PROVIDER,
    cases: [
        {
            id: "SHOTSTACK-1",
            label: "A render is accepted (queued) and later completes: status reads see queued, rendering, then done with its video address",
            operation: "start",
            outcome: "ok",
            default: true,
        },
        { id: "SHOTSTACK-2", label: "A render is accepted and later fails: status reads end at failed with Shotstack's reason", operation: "start", outcome: "ok" },
        {
            id: "SHOTSTACK-8",
            label: "A render is accepted and never finishes: status reads see queued, then rendering for ever (the run's deadline reads it and ends the wait)",
            operation: "start",
            outcome: "ok",
        },
        { id: "SHOTSTACK-3", label: "An Edit is refused at start (400): rejected, nothing sent", operation: "start", outcome: "refused" },
        { id: "SHOTSTACK-9", label: "A render is refused at start because the key is refused (401): auth_refused, nothing sent", operation: "start", outcome: "refused" },
        {
            id: "SHOTSTACK-10",
            label: "A render start is answered 429 (rate limit): the live adapter's rate-limit error proving not_sent, no render exists, a retry may pass",
            operation: "start",
            outcome: "transient",
        },
        {
            id: "SHOTSTACK-11",
            label: "A render start gets no answer (timeout): the live adapter's `Unreachable` proving unknown, but NOTHING was started: no render exists",
            operation: "start",
            outcome: "timeout",
        },
        {
            id: "SHOTSTACK-4",
            label: "A render start ends in an unknown outcome (5xx): the render exists, the caller cannot know it",
            operation: "start",
            outcome: "timeout",
        },
        {
            id: "SHOTSTACK-12",
            label: "A status read of a render the account started: the render as its life (chosen at start) shows it, one step per read",
            operation: "statusOf",
            outcome: "ok",
            default: true,
        },
        {
            id: "SHOTSTACK-5",
            label: "A status read of a render the account does not hold: not_found refusal (also what the default answers for an id never started)",
            operation: "statusOf",
            outcome: "refused",
        },
        { id: "SHOTSTACK-13", label: "A status read refused for the key (401): auth_refused, nothing read", operation: "statusOf", outcome: "refused" },
        { id: "SHOTSTACK-14", label: "A status read answered 429 (rate limit): the live adapter's rate-limit error, a retry may pass", operation: "statusOf", outcome: "transient" },
        { id: "SHOTSTACK-15", label: "A status read gets no answer (timeout): the live adapter's `Unreachable`", operation: "statusOf", outcome: "timeout" },
        {
            id: "SHOTSTACK-6",
            label: "The callback reports a render that is done (the render named, by default the first of the account): done with its video address",
            inbound: webhookCase(shotstackSandboxRenderId(0), doneBody),
        },
        {
            id: "SHOTSTACK-7",
            label: "The callback reports a render that failed (the render named, by default the second of the account): failed with its error",
            inbound: webhookCase(shotstackSandboxRenderId(1), (id) => ({
                type: "edit",
                action: "render",
                id,
                owner: SHOTSTACK_SANDBOX_OWNER,
                status: "failed",
                url: null,
                error: SHOTSTACK_SANDBOX_FAILED_MESSAGE,
                completed: SHOTSTACK_SANDBOX_COMPLETED_AT,
            })),
        },
        {
            id: "SHOTSTACK-16",
            label: "The callback is of another action (copy: not a render of an edit; shotstack-callback.policy.spec.ts): the live mapper reads no finished render, the door keeps nothing",
            inbound: webhookCase(shotstackSandboxRenderId(0), (id) => ({ ...doneBody(id), action: "copy" })),
        },
        {
            id: "SHOTSTACK-17",
            label: "The callback says done but carries no https video address: the live mapper reads no finished render, the door keeps nothing",
            inbound: webhookCase(shotstackSandboxRenderId(0), (id) => ({ ...doneBody(id), url: null })),
        },
        {
            id: "SHOTSTACK-18",
            label: "The callback reports a render the account never started (a fixed render id nobody asked for): the door keeps it once and no waiting run matches it",
            inbound: {
                trigger: RENDER_COMPLETED,
                path: webhookPath,
                inputs: [],
                eventsOf: async () => [{ body: doneBody(SHOTSTACK_SANDBOX_NEVER_STARTED_ID) }],
            },
        },
    ],
}
