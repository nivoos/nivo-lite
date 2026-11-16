import type { SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** The provider key the Google ledger sandbox answers for. */
export const GOOGLE_LEDGER_SANDBOX_PROVIDER = "google"

/** The ledger port methods the cases below answer (the port's own method names). */
export const GOOGLE_LEDGER_OPERATION = {
    ready: "ready",
    append: "append",
    void: "void",
} as const

/** The ids of the cases the implementation answers (it reads `state.nextCase` against them; the first of each operation is its default). */
export const GOOGLE_LEDGER_CASE = {
    /** GOOGLE-LEDGER-1 (default of `ready`): the account gave the spreadsheets access and was told the sheet. */
    ready: "GOOGLE-LEDGER-1",
    /** GOOGLE-LEDGER-2: the account has no ledger sheet told yet: not ready. */
    notReady: "GOOGLE-LEDGER-2",
    /** GOOGLE-LEDGER-3 (default of `append`): the row is appended and Google answers its range. */
    appended: "GOOGLE-LEDGER-3",
    /** GOOGLE-LEDGER-4: Google refuses the sheet or the access: the refused ledger connection. */
    appendRefused: "GOOGLE-LEDGER-4",
    /** GOOGLE-LEDGER-5: Google never answers the append: the outcome is unknown. */
    appendNoAnswer: "GOOGLE-LEDGER-5",
    /** GOOGLE-LEDGER-6: the append fails before it reaches Google (a rate limit or a 5xx on the token): nothing left. */
    appendFailed: "GOOGLE-LEDGER-6",
    /** GOOGLE-LEDGER-7 (default of `void`): the void row is appended. */
    voided: "GOOGLE-LEDGER-7",
    /** GOOGLE-LEDGER-8: Google refuses the sheet or the access on the void: the refused ledger connection. */
    voidRefused: "GOOGLE-LEDGER-8",
    /** GOOGLE-LEDGER-9: the void fails before it reaches Google (a rate limit or a 5xx on the token): nothing left. */
    voidFailed: "GOOGLE-LEDGER-9",
    /** GOOGLE-LEDGER-10: Google never answers the void: the outcome is unknown. */
    voidNoAnswer: "GOOGLE-LEDGER-10",
    /** GOOGLE-LEDGER-11: Google never answers the append but the row WAS appended. */
    appendAppliedNoAnswer: "GOOGLE-LEDGER-11",
    /** GOOGLE-LEDGER-12: Google never answers the void but the void row WAS appended. */
    voidAppliedNoAnswer: "GOOGLE-LEDGER-12",
} as const

/**
 * The hardcoded outbound cases of the Google ledger sandbox (R62): the account's sticky NEXT CASE picks one per operation, the first
 * of each operation answers while nothing is picked. Rows are appended after the header row (row 1), so the first entry is row 2.
 */
export const GOOGLE_LEDGER_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: GOOGLE_LEDGER_SANDBOX_PROVIDER,
    cases: [
        {
            id: GOOGLE_LEDGER_CASE.ready,
            label: "The account is ready: it gave the spreadsheets access and was told the ledger sheet",
            operation: GOOGLE_LEDGER_OPERATION.ready,
            outcome: "ok",
            default: true,
        },
        {
            id: GOOGLE_LEDGER_CASE.notReady,
            label: "The account is not ready: no ledger sheet was told, so the ledger step is skipped",
            operation: GOOGLE_LEDGER_OPERATION.ready,
            outcome: "ok",
        },
        {
            id: GOOGLE_LEDGER_CASE.appended,
            label: "An entry is appended as the next row of the cash book tab and Google answers the row's range",
            operation: GOOGLE_LEDGER_OPERATION.append,
            outcome: "ok",
            default: true,
        },
        {
            id: GOOGLE_LEDGER_CASE.appendRefused,
            label: "Google refuses the sheet or the access: the refused ledger connection, which only the owner can cure; no row is kept",
            operation: GOOGLE_LEDGER_OPERATION.append,
            outcome: "refused",
        },
        {
            id: GOOGLE_LEDGER_CASE.appendNoAnswer,
            label: "Google gives no answer to the append: the outcome is unknown (proof unknown) and no row is kept",
            operation: GOOGLE_LEDGER_OPERATION.append,
            outcome: "timeout",
        },
        {
            id: GOOGLE_LEDGER_CASE.appendFailed,
            label: "The append fails before it reaches Google: a call failure proved not sent, no row is kept",
            operation: GOOGLE_LEDGER_OPERATION.append,
            outcome: "transient",
        },
        {
            id: GOOGLE_LEDGER_CASE.voided,
            label: "A void is appended as the next row, naming the transaction, and Google answers the row's range",
            operation: GOOGLE_LEDGER_OPERATION.void,
            outcome: "ok",
            default: true,
        },
        {
            id: GOOGLE_LEDGER_CASE.voidRefused,
            label: "Google refuses the sheet or the access on the void: the refused ledger connection; no row is kept",
            operation: GOOGLE_LEDGER_OPERATION.void,
            outcome: "refused",
        },
        {
            id: GOOGLE_LEDGER_CASE.voidFailed,
            label: "The void fails before it reaches Google: a call failure proved not sent, no row is kept",
            operation: GOOGLE_LEDGER_OPERATION.void,
            outcome: "transient",
        },
        {
            id: GOOGLE_LEDGER_CASE.voidNoAnswer,
            label: "Google gives no answer to the void: the outcome is unknown (proof unknown) and no row is kept",
            operation: GOOGLE_LEDGER_OPERATION.void,
            outcome: "timeout",
        },
        {
            id: GOOGLE_LEDGER_CASE.appendAppliedNoAnswer,
            label: "Google takes the append but never answers: the row WAS appended (kept in state), the append says unknown (proof unknown)",
            operation: GOOGLE_LEDGER_OPERATION.append,
            outcome: "timeout",
        },
        {
            id: GOOGLE_LEDGER_CASE.voidAppliedNoAnswer,
            label: "Google takes the void but never answers: the void row WAS appended (kept in state), the void says unknown (proof unknown)",
            operation: GOOGLE_LEDGER_OPERATION.void,
            outcome: "timeout",
        },
    ],
}
