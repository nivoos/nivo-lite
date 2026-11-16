import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"
import { MODEL_PROVIDER } from "./model-provider.contracts"

/**
 * The operation every model call of a sandbox model account is picked under for the WHOLE workspace (the next-case selector of the page).
 * A call is LOGGED under its own purpose, and a case picked for one purpose (`setNextCase(..., scope: <purpose>)`) wins over this one.
 */
export const MODEL_CALL_OPERATION = "call"

/** The model name every answer the sandbox makes itself is served under: its meter row says the sandbox, never a real model. */
export const MODEL_SANDBOX_MODEL = "nivo-sandbox"

/** The upstream the sandbox's own answers name (the meter's `upstream`). */
export const MODEL_SANDBOX_UPSTREAM = "NIVO Sandbox"

/** The case ids, for the sandbox runner, its specs and the matrix. */
export const MODEL_SANDBOX_CASE = {
    passed: "MODEL-1",
    refused: "MODEL-2",
    malformed: "MODEL-3",
    timedOut: "MODEL-4",
    providerError: "MODEL-5",
    cut: "MODEL-6",
    confused: "MODEL-7",
    answered: "MODEL-8",
    toolCall: "MODEL-9",
    tooLong: "MODEL-10",
    rateLimited: "MODEL-11",
} as const

/** A model sandbox case id. */
export type ModelSandboxCaseId = (typeof MODEL_SANDBOX_CASE)[keyof typeof MODEL_SANDBOX_CASE]

/**
 * The model provider's hardcoded sandbox cases (rulings R59, R62, R87 lever b; SBX standard 2026-11-15). Each case is EXACTLY what the live
 * endpoint can return or throw, read by NIVO's own model door unchanged (`AiService`: `attempt`, `readTurn`, `failureOfThrow`), so the
 * tries, the stop and the facts step's own reading run as they do on a real failure. Sticky (rule 12): every try of a call sees the
 * same case. `MODEL-1` is the default: a sandbox model account changes nothing until a case is picked, so a workspace can still be walked
 * with the REAL model behind sandbox channels; `MODEL-8` / `MODEL-9` answer with NO endpoint at all (a fixed answer in the asked shape, a
 * fixed call of the first tool offered). The outcome tags are the standard's generic ones: `ok` the provider answered (the door judges
 * the answer), `refused` it refused, `transient` it said "not now" (429, 5xx), `timeout` no answer.
 */
export const MODEL_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: MODEL_PROVIDER,
    cases: [
        {
            id: MODEL_SANDBOX_CASE.passed,
            label: "The call goes to the real model endpoint (default: a sandbox model account changes nothing)",
            operation: MODEL_CALL_OPERATION,
            outcome: "ok",
            default: true,
        },
        {
            id: MODEL_SANDBOX_CASE.answered,
            label: "A fixed answer, no endpoint: a chat call gets the smallest value that fits the asked schema (JSON Schema or zod), as text and parsed; an agent turn gets the `done` call with the `done` tool's own output",
            operation: MODEL_CALL_OPERATION,
            outcome: "ok",
        },
        {
            id: MODEL_SANDBOX_CASE.toolCall,
            label: "A fixed tool call, no endpoint: an agent turn calls the FIRST tool the request offered with the smallest arguments its schema allows (a chat call has no tools and gets the fixed answer)",
            operation: MODEL_CALL_OPERATION,
            outcome: "ok",
        },
        {
            id: MODEL_SANDBOX_CASE.refused,
            label: "The model refuses: finish `refusal` with no text (the model door reads it as an empty answer, a failed try)",
            operation: MODEL_CALL_OPERATION,
            outcome: "refused",
        },
        {
            id: MODEL_SANDBOX_CASE.tooLong,
            label: "The provider refuses the request as longer than the context: `BadRequestError`, HTTP 400 (a failed try `provider`; the same prompt fails every try)",
            operation: MODEL_CALL_OPERATION,
            outcome: "refused",
        },
        {
            id: MODEL_SANDBOX_CASE.malformed,
            label: "The model answers one line of prose where a JSON object or a structured answer is asked (malformed for the schema)",
            operation: MODEL_CALL_OPERATION,
            outcome: "ok",
        },
        {
            id: MODEL_SANDBOX_CASE.timedOut,
            label: "The model does not answer before the deadline: the call throws a timeout (a failed try `timeout`)",
            operation: MODEL_CALL_OPERATION,
            outcome: "timeout",
        },
        {
            id: MODEL_SANDBOX_CASE.providerError,
            label: "The provider fails: HTTP 503 (a failed try `provider`, retried after the pause)",
            operation: MODEL_CALL_OPERATION,
            outcome: "transient",
        },
        {
            id: MODEL_SANDBOX_CASE.rateLimited,
            label: "The provider answers its rate limit: `RateLimitError`, HTTP 429 (a failed try `provider`, retried after the pause)",
            operation: MODEL_CALL_OPERATION,
            outcome: "transient",
        },
        {
            id: MODEL_SANDBOX_CASE.cut,
            label: "The answer is cut at the token limit: finish `length`, half a JSON object (a failed try `length`)",
            operation: MODEL_CALL_OPERATION,
            outcome: "ok",
        },
        {
            id: MODEL_SANDBOX_CASE.confused,
            label: "The model says it cannot decide, in the node's own protocol: `confused` with a reason and no question",
            operation: MODEL_CALL_OPERATION,
            outcome: "ok",
        },
    ] satisfies ReadonlyArray<SandboxCase>,
}

/** The case of an id the catalogue holds, else null. */
export const modelCaseOf = (id: string | null): ModelSandboxCaseId | null =>
    Object.values(MODEL_SANDBOX_CASE).find((one) => one === id) ?? null
