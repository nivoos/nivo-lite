import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"
import { OPENAPI_PROVIDER } from "@modules/domain/openapi-tools"

/** The operation of an API call in the sandbox call log and in the account's next-case selector (one for every document operation). */
export const OPENAPI_CALL_OPERATION = "call"

/** The status the refusal case answers: the system understood the call and refused it (a 4xx: the connector reads it as the system's answer). */
export const OPENAPI_SANDBOX_REFUSAL_STATUS = 422

/** The status the failure case answers: the system failed (a 5xx: the effect of the call is unknown). */
export const OPENAPI_SANDBOX_FAILURE_STATUS = 503

/** The status the lost-answer case answers: the gateway timed out (the call may have been applied: the effect is unknown). */
export const OPENAPI_SANDBOX_TIMEOUT_STATUS = 504

/** The status an item read, change or act answers when the account's store holds no record of that key. */
export const OPENAPI_SANDBOX_NOT_FOUND_STATUS = 404

/** How long the slow case waits before it answers, milliseconds (under the account's lock: its calls answer one after the other). */
export const OPENAPI_SANDBOX_SLOW_MS = 3000

/** The case ids, for the sandbox service and its specs. */
export const OPENAPI_SANDBOX_CASE = {
    answered: "OPENAPI-1",
    refused: "OPENAPI-2",
    failed: "OPENAPI-3",
    timedOut: "OPENAPI-4",
    lost: "OPENAPI-5",
    slow: "OPENAPI-6",
} as const

/**
 * The OpenAPI provider's hardcoded sandbox cases (R62): GENERIC over every operation of every pinned document (the engine knows no
 * system's noun, R75). The account's NEXT CASE picks the outcome, sticky: picked for ONE operation (the scope is the document's operation
 * id, the key the call log shows), else for every call (`call`); `OPENAPI-1` answers while nothing is picked, from the account's store
 * (`openapi-sandbox-store.policy`: every operation of the document, started with the records the package that pins it declares).
 */
export const OPENAPI_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: OPENAPI_PROVIDER,
    cases: [
        {
            id: OPENAPI_SANDBOX_CASE.answered,
            label: "The system answers from the account's store: every operation of the document (create, list, read, change, act), started with the package's records",
            operation: OPENAPI_CALL_OPERATION,
            outcome: "ok",
            default: true,
        },
        {
            id: OPENAPI_SANDBOX_CASE.refused,
            label: "The system refuses the call: the package's own 4xx answer of the operation, else HTTP 422 (the connector reads it as the system's refusal; nothing applied)",
            operation: OPENAPI_CALL_OPERATION,
            outcome: "refused",
        },
        {
            id: OPENAPI_SANDBOX_CASE.failed,
            label: "The system fails: the package's own 5xx answer of the operation, else HTTP 503 (the effect is unknown; nothing kept)",
            operation: OPENAPI_CALL_OPERATION,
            outcome: "transient",
        },
        {
            id: OPENAPI_SANDBOX_CASE.timedOut,
            label: "The call is applied but its answer is lost: the write is kept, then HTTP 504 (the effect is unknown)",
            operation: OPENAPI_CALL_OPERATION,
            outcome: "timeout",
        },
        {
            id: OPENAPI_SANDBOX_CASE.lost,
            label: "The request is lost before it applied: no answer before the deadline (a timeout; the effect is unknown; nothing kept)",
            operation: OPENAPI_CALL_OPERATION,
            outcome: "timeout",
        },
        {
            id: OPENAPI_SANDBOX_CASE.slow,
            label: `The system answers as OPENAPI-1, after ${String(OPENAPI_SANDBOX_SLOW_MS / 1000)} seconds`,
            operation: OPENAPI_CALL_OPERATION,
            outcome: "ok",
        },
    ] satisfies ReadonlyArray<SandboxCase>,
}
