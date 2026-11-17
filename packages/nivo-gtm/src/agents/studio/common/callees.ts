import type { Callee, JsonValue } from "@starci/nivoos-sdk"

/** `brain.search`: the workspace's truths and document passages nearest to a query, in the run's lens (an internal run reads both areas; a customer-facing run reads public rows only). */
export type BrainSearch = Callee<
    "brain.search",
    { readonly query: string; readonly limit?: number },
    { readonly hits: ReadonlyArray<{ readonly kind: string; readonly score: number; readonly truth: JsonValue; readonly passage: JsonValue }> }
>
