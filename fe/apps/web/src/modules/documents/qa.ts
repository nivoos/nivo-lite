/** One question and its answer. */
export interface QaPair {
    readonly q: string
    readonly a: string
}

/** The words that label a question and an answer in the stored text. */
export interface QaLabels {
    readonly question: string
    readonly answer: string
}

/** The Q&A pairs of a list as text, so each pair stays in one passage. */
export const pairsToText = (pairs: ReadonlyArray<QaPair>, labels: QaLabels): string =>
    pairs
        .filter((pair) => pair.q.trim() !== "" && pair.a.trim() !== "")
        .map((pair) => `${labels.question}: ${pair.q.trim()}\n${labels.answer}: ${pair.a.trim()}`)
        .join("\n\n")
