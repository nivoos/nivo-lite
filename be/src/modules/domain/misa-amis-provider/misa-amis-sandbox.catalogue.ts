import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The word of the operation the live twin names in its refusal: AMIS's voucher creation, whose documentation could not be read. */
export const AMIS_SANDBOX_REFUSAL_OPERATION = "voucher.create"

/** The ledger port methods the cases below answer (the port's own method names). */
export const AMIS_SANDBOX_OPERATION = {
    ready: "ready",
    append: "append",
    void: "void",
} as const

/** The ids of the cases the implementation answers (it reads `state.nextCase` against them; the first of each operation is its default). */
export const AMIS_SANDBOX_CASE = {
    /** MISA-AMIS-1 (default of `ready`): a sandbox AMIS account is ready (the live twin is never ready while no operation is built). */
    ready: "MISA-AMIS-1",
    /** MISA-AMIS-2 (default of `append`): the entry is booked as a voucher. */
    appended: "MISA-AMIS-2",
    /** MISA-AMIS-3: AMIS refuses the voucher `not_available` (`voucher.create`, not sent): the live refusal shape. */
    appendRefused: "MISA-AMIS-3",
    /** MISA-AMIS-4: AMIS gives no answer to the voucher: the outcome is unknown. */
    appendNoAnswer: "MISA-AMIS-4",
    /** MISA-AMIS-5 (default of `void`): the void voucher is booked. */
    voided: "MISA-AMIS-5",
    /** MISA-AMIS-6: AMIS refuses the void voucher `not_available` (`voucher.create`, not sent): the live refusal shape. */
    voidRefused: "MISA-AMIS-6",
    /** MISA-AMIS-7 (of `ready`): the account is NOT ready: the live twin's own answer while no operation is built, the ledger tool never picks it. */
    notReady: "MISA-AMIS-7",
    /** MISA-AMIS-8: the voucher fails "not now" before anything is kept (not sent): a retry may pass. */
    appendTransient: "MISA-AMIS-8",
    /** MISA-AMIS-9: the voucher is booked and kept, then the answer is lost (unknown, the voucher exists). */
    appendAppliedLost: "MISA-AMIS-9",
    /** MISA-AMIS-10: a void of a transaction the account never appended: refused `not_found` (not sent), whatever the state. */
    voidNotFound: "MISA-AMIS-10",
    /** MISA-AMIS-11: AMIS refuses the account's credential on the voucher: the ledger connection refused. */
    appendCredentialRefused: "MISA-AMIS-11",
    /** MISA-AMIS-12: the void gets no answer and nothing was added (unknown). */
    voidNoAnswer: "MISA-AMIS-12",
    /** MISA-AMIS-13: the void fails "not now" before anything is added (not sent). */
    voidTransient: "MISA-AMIS-13",
    /** MISA-AMIS-14: the void voucher is added, then the answer is lost (unknown, the void exists). */
    voidAppliedLost: "MISA-AMIS-14",
    /** MISA-AMIS-15: AMIS refuses the account's credential on the void: the ledger connection refused. */
    voidCredentialRefused: "MISA-AMIS-15",
} as const

/**
 * The hardcoded outbound cases of the MISA AMIS ledger sandbox (R62): ids `MISA-AMIS-<n>`, identical on every machine. The account's
 * sticky NEXT CASE picks one per operation; the first of each operation answers while nothing is picked.
 */
export const AMIS_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: PROVIDER.misaAmis,
    cases: [
        {
            id: AMIS_SANDBOX_CASE.ready,
            label: "A sandbox AMIS account is ready: the ledger tool may pick it (the live twin is never ready while no operation is built)",
            operation: AMIS_SANDBOX_OPERATION.ready,
            outcome: "ok",
            default: true,
        },
        {
            id: AMIS_SANDBOX_CASE.appended,
            label: "An entry is appended as a voucher kept in state, answering the running reference SBX-AMIS-<n>",
            operation: AMIS_SANDBOX_OPERATION.append,
            outcome: "ok",
            default: true,
        },
        {
            id: AMIS_SANDBOX_CASE.appendRefused,
            label: "AMIS refuses the voucher not_available (voucher.create, not sent), the live refusal shape; nothing is kept",
            operation: AMIS_SANDBOX_OPERATION.append,
            outcome: "refused",
        },
        {
            id: AMIS_SANDBOX_CASE.appendNoAnswer,
            label: "AMIS gives no answer to the voucher: the outcome is unknown (proof unknown); nothing is kept",
            operation: AMIS_SANDBOX_OPERATION.append,
            outcome: "timeout",
        },
        {
            id: AMIS_SANDBOX_CASE.voided,
            label: "The void of a transaction the account appended adds the void voucher, answering the running reference SBX-AMIS-VOID-<n>",
            operation: AMIS_SANDBOX_OPERATION.void,
            outcome: "ok",
            default: true,
        },
        {
            id: AMIS_SANDBOX_CASE.voidRefused,
            label: "AMIS refuses the void voucher not_available (voucher.create, not sent), the live refusal shape",
            operation: AMIS_SANDBOX_OPERATION.void,
            outcome: "refused",
        },
        {
            id: AMIS_SANDBOX_CASE.appendTransient,
            label: "The voucher fails \"not now\" before anything is kept (the generic call failure, not sent): a retry may pass",
            operation: AMIS_SANDBOX_OPERATION.append,
            outcome: "transient",
        },
        {
            id: AMIS_SANDBOX_CASE.appendAppliedLost,
            label: "The voucher is booked and kept in state, then the answer is lost (the generic call failure, unknown): the voucher exists",
            operation: AMIS_SANDBOX_OPERATION.append,
            outcome: "timeout",
        },
        {
            id: AMIS_SANDBOX_CASE.appendCredentialRefused,
            label: "AMIS refuses the account's credential on the voucher: the ledger connection refused (PROVIDER_REGISTRY_LEDGER_CONNECTION_REFUSED, the owner connects again); nothing is kept",
            operation: AMIS_SANDBOX_OPERATION.append,
            outcome: "refused",
        },
        {
            id: AMIS_SANDBOX_CASE.voidNotFound,
            label: "The void names a transaction the account never appended: refused not_found (voucher, not sent), whatever the state",
            operation: AMIS_SANDBOX_OPERATION.void,
            outcome: "refused",
        },
        {
            id: AMIS_SANDBOX_CASE.voidNoAnswer,
            label: "AMIS gives no answer to the void: the outcome is unknown (proof unknown); nothing is added",
            operation: AMIS_SANDBOX_OPERATION.void,
            outcome: "timeout",
        },
        {
            id: AMIS_SANDBOX_CASE.voidTransient,
            label: "The void fails \"not now\" before anything is added (the generic call failure, not sent): a retry may pass",
            operation: AMIS_SANDBOX_OPERATION.void,
            outcome: "transient",
        },
        {
            id: AMIS_SANDBOX_CASE.voidAppliedLost,
            label: "The void voucher is added, then the answer is lost (the generic call failure, unknown): the void exists",
            operation: AMIS_SANDBOX_OPERATION.void,
            outcome: "timeout",
        },
        {
            id: AMIS_SANDBOX_CASE.voidCredentialRefused,
            label: "AMIS refuses the account's credential on the void: the ledger connection refused; nothing is added",
            operation: AMIS_SANDBOX_OPERATION.void,
            outcome: "refused",
        },
        {
            id: AMIS_SANDBOX_CASE.notReady,
            label: "The account is NOT ready (the live twin's own answer while no operation is built): the ledger tool never picks it",
            operation: AMIS_SANDBOX_OPERATION.ready,
            outcome: "ok",
        },
    ],
}
