import type { CellExecutor } from "./cell-executor.port"
import type { CellDefinitionView, JsonValue, ToolAnswer } from "./cells.contracts"

/*
 * The contracts of the generic test kit (CELLS-PLAN 7.4, slice S5): what a proof says, and the world the kit runs a cell in. The kit knows a
 * cell only by its ROW; the world is whatever wiring of the executor the caller has (doubles in a spec, the real runner and ledger in a gate).
 */

/** Every case the kit can run, in the order it runs them. */
export const PROOF_CASES = [
    "examples",
    "valid-input",
    "invalid-input",
    "output-shape",
    "refusal-classes",
    "refusal-final",
    "refusal-undeclared",
    "transient",
    "unknown-outcome",
    "intent-once",
    "repeatable",
    "declared-tools",
    "undeclared-tool",
    "limits",
    "determinism",
    "metered",
    "if-truth-table",
    "set-update",
    "set-undeclared",
    "config-checks",
] as const

/** One case of the kit. */
export type ProofCaseId = (typeof PROOF_CASES)[number]

/** `pass`, `fail` (the cell breaks its own declaration) or `na` (the row declares nothing the case could judge; `detail` says why). */
export interface ProofCaseResult {
    readonly id: ProofCaseId
    readonly status: "pass" | "fail" | "na"
    readonly detail: string
}

/** The proof of one cell: every case and whether the cell holds (no case failed). */
export interface CellProof {
    readonly cell: string
    readonly ok: boolean
    readonly cases: ReadonlyArray<ProofCaseResult>
}

/** What a scripted tool answers: an answer, or a function of the arguments and of how many times the tool was called before. */
export type ProofToolReply = ToolAnswer | ((args: JsonValue, nth: number) => ToolAnswer)

/** One call the tool door took, as the kit observed it. */
export interface ProofDoorCall {
    readonly tool: string
    readonly args: JsonValue
    /** The intent key of the call (the executor passes it on for a vendor replay key). */
    readonly key: string
}

/** One booking of the credit meter. */
export interface ProofBooking {
    readonly units: number
    readonly billed: boolean
}

/** What happened in a world since it was opened. */
export interface ProofObservation {
    readonly doorCalls: ReadonlyArray<ProofDoorCall>
    /** How many times a stored source was run. */
    readonly sourceRuns: number
    readonly bookings: ReadonlyArray<ProofBooking>
}

/**
 * One fresh world: an executor wired to a reader that holds the rows and sources the kit installs, a scripted tool door, a ledger and a meter that
 * start empty, and, for a stored source, a runner whose limits are small enough for the kit's limit probes to end within a second or two.
 */
export interface CellProofWorld {
    readonly executor: CellExecutor
    /** Makes the rows and the source texts readable by the executor; the sources are keyed by their sha256 on the reader. */
    install(rows: ReadonlyArray<CellDefinitionView>, sources: ReadonlyArray<string>): void
    /** Sets what each tool answers; a tool not scripted is refused `tool_unscripted`. */
    script(replies: Readonly<Record<string, ProofToolReply>>): void
    /** Sets the credit pool of the proof workspace (units). A pool left unset is empty. */
    fund(units: number): void
    observed(): ProofObservation
}

/** Opens fresh worlds: every case starts from an empty ledger and an empty meter. */
export interface CellProofWorlds {
    open(): CellProofWorld
}
