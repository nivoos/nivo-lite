import type { Callee, JsonValue } from "@starci/nivoos-sdk"

/** `brain.search`: the workspace's truths and document passages nearest to a query, in the run's lens. */
export type BrainSearch = Callee<
    "brain.search",
    { readonly query: string; readonly limit?: number },
    {
        readonly hits: ReadonlyArray<{
            readonly kind: string
            readonly score: number
            readonly truth: JsonValue
            readonly passage: JsonValue
        }>
    }
>

type Hit = { readonly kind: string; readonly score: number; readonly truth: JsonValue; readonly passage: JsonValue }

const isJsonRecord = (value: JsonValue): value is { readonly [key: string]: JsonValue } =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const areaOf = (value: JsonValue): string => {
    if (!isJsonRecord(value)) return ""
    const area = value["area"]
    return typeof area === "string" ? area : ""
}

/**
 * What a customer may be told: only the hits whose area is `public`. A run on a CONTACT is customer-facing and the engine reads the public area for it; a run on a lead
 * (the follow-up, the demo, a signal) has the team's lens, so a cell that writes to a customer keeps the public hits itself.
 */
export const publicHitsOf = (
    hits: ReadonlyArray<Hit>,
): ReadonlyArray<{ readonly kind: string; readonly truth: JsonValue; readonly passage: JsonValue }> =>
    hits
        .filter((hit) => areaOf(hit.kind === "truth" ? hit.truth : hit.passage) === "public")
        .map((hit) => ({ kind: hit.kind, truth: hit.truth, passage: hit.passage }))
