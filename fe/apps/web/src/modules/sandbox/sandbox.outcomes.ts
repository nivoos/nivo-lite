import type { SandboxCasesQuery, SandboxNextCasesQuery } from "@/modules/api"
import type { SandboxOutcomeRowView } from "@/modules/types"

/** The outcomes the sandbox frame knows, in the order they are offered; a provider's operation offers the ones its cases are tagged with. */
export const SANDBOX_OUTCOMES = ["ok", "refused", "final", "transient", "timeout"] as const

/** The outcome that answers when nothing else is picked. */
export const SANDBOX_OUTCOME_OK = "ok"

/** The cases and the picks as the back end answers them. */
type CaseWire = Pick<SandboxCasesQuery["sandboxCases"][number], "id" | "direction" | "operation" | "isDefault" | "outcome">
type NextWire = SandboxNextCasesQuery["sandboxNextCases"][number]

/** The position of an outcome in the offered order; an outcome the frame does not know goes after the known ones, in the order met. */
const rankOf = (outcome: string): number => {
    const at = (SANDBOX_OUTCOMES as ReadonlyArray<string>).indexOf(outcome)
    return at === -1 ? SANDBOX_OUTCOMES.length : at
}

/**
 * One row per outbound operation that offers a choice of outcome (its cases carry at least two tags): the outcomes it offers, and the one
 * it answers now, read from the case the account answers next. A case picked by id that carries no tag leaves `current` null and
 * names the case, so the row says it answers a specific case rather than a generic outcome. Nothing here names a provider or an operation.
 */
export const outcomeRowsOf = (
    cases: ReadonlyArray<CaseWire>,
    next: ReadonlyArray<NextWire>,
): ReadonlyArray<SandboxOutcomeRowView> => {
    const operations = new Map<string, Array<CaseWire>>()
    for (const one of cases) {
        if (one.direction === "inbound" || one.operation === null || one.operation === undefined) continue
        operations.set(one.operation, [...(operations.get(one.operation) ?? []), one])
    }
    return [...operations.entries()].flatMap(([operation, own]) => {
        const options = [...new Set(own.flatMap((one) => (one.outcome === null || one.outcome === undefined ? [] : [one.outcome])))].sort(
            (left, right) => rankOf(left) - rankOf(right),
        )
        if (options.length < 2) return []
        const entry = next.find((one) => one.operation === operation)
        const picked = entry === undefined ? own.find((one) => one.isDefault) : own.find((one) => one.id === entry.caseId)
        const tag = picked?.outcome
        const current = tag === null || tag === undefined ? (picked?.isDefault === true ? SANDBOX_OUTCOME_OK : null) : tag
        return [{ operation, options, current, caseId: picked?.id ?? entry?.caseId ?? null }]
    })
}
