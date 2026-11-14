import type { CellOutcome, CellSemantics, CellVerdict } from "./cells.contracts"

/** The cause code of a failure that is an empty credit pool: the executor stopped before running (CELLS-PLAN 6). */
export const CREDITS_EXHAUSTED_CODE = "credits_exhausted"

/** Whether the cell writes outside NIVO's database; `mutates` with no `outside` means outside (the V1 default). */
export const writesOutside = (semantics: CellSemantics): boolean => semantics.mutates && semantics.outside !== false

/** Whether a refusal code is final for the cell: declared in `finalRefusals`, and only a write has finals. */
export const isFinalRefusal = (semantics: CellSemantics, code: string): boolean =>
    semantics.mutates && (semantics.finalRefusals ?? []).includes(code)

/** Whether a refusal code is one the cell declared (final ones are part of `refusals`). */
export const isDeclaredRefusal = (semantics: CellSemantics, code: string): boolean =>
    (semantics.refusals ?? []).includes(code) || (semantics.finalRefusals ?? []).includes(code)

/** The verdict of an unknown outcome: only the cell's declarations decide how it is settled, never the model or the words of a message. */
const unknownVerdictOf = (semantics: CellSemantics, key: string): CellVerdict => {
    if (!semantics.mutates) return { kind: "retry" }
    if (semantics.repeatable === true) return { kind: "repeat", key }
    if (semantics.confirmBy !== undefined) return { kind: "confirm", read: { tool: semantics.confirmBy.tool, args: semantics.confirmBy.args } }
    return { kind: "stop", why: "outcome_unknown", retry: "after_take_over" }
}

/**
 * THE classifier (CELLS-PLAN 1.1, 1.5): what the engine does after one execution, from what the cell DECLARES and what it answered. Pure.
 *
 * | outcome | semantics | verdict |
 * |---|---|---|
 * | ok | any | continue |
 * | ending (cannot, declined) | any | unsuccessful (reason = the ending) |
 * | refused-final | any | unsuccessful (reason = the code) |
 * | refused | writes outside NIVO | stop act_refused |
 * | refused | a read, or a write inside NIVO | continue |
 * | transient | any | retry |
 * | unknown | not a write | retry |
 * | unknown | write, repeatable | repeat (the same key) |
 * | unknown | write, confirmBy | confirm (the declared read) |
 * | unknown | write, neither | stop outcome_unknown, retry only after a person takes over |
 * | failed (confused, permanent, limits) | any | stop failed |
 * | failed (credits exhausted) | any | stop credits_exhausted |
 */
export const verdictOf = (semantics: CellSemantics, outcome: CellOutcome): CellVerdict => {
    switch (outcome.kind) {
        case "ok":
            return { kind: "continue" }
        case "ending":
            return { kind: "unsuccessful", reason: outcome.reason }
        case "refused-final":
            return { kind: "unsuccessful", reason: outcome.code }
        case "refused":
            return writesOutside(semantics) ? { kind: "stop", why: "act_refused" } : { kind: "continue" }
        case "transient":
            return { kind: "retry" }
        case "unknown":
            return unknownVerdictOf(semantics, outcome.key)
        case "failed":
            return outcome.cause?.code === CREDITS_EXHAUSTED_CODE ? { kind: "stop", why: "credits_exhausted" } : { kind: "stop", why: "failed" }
    }
}
