"use client"

import { useMemo } from "react"
import { useQueryKnowledgeSourcesSwr } from "@/hooks/swr"
import { slotOfSwr } from "@/hooks/slot"
import { liveOf, toDocumentTruths, toKnowledgeDocument, type LiveProgress } from "@/modules/documents"
import type { ModuleKey } from "@/modules/catalog"
import { readError } from "@/hooks/workspaceread"
import type { DataSlot, DocumentTruths, KnowledgeDocument } from "@/modules/types"

/** The view `useKnowledgeSources` returns. */
export interface KnowledgeSourcesView {
    sources: KnowledgeDocument[] | undefined
    live: {
        [k: string]: LiveProgress
    }
    /** Where the truths work of each document stands, by document id; null until the document is indexed. */
    truths: { [k: string]: DocumentTruths | null }
    error: unknown
    isLoading: boolean
    slot: DataSlot<KnowledgeDocument[]>
    reload: () => undefined
}

/**
 * The documents of the active workspace, in the shape the blocks know. While a worker is on a document the list polls, so its status
 * and stored progress move on their own; the state of the jobs of a document comes from `useKnowledgeJobs`, where a list draws it.
 * `module` = "all" or undefined lists every document.
 */
export const useKnowledgeSources = (module?: ModuleKey | "all"): KnowledgeSourcesView => {
    const swrRead = useQueryKnowledgeSourcesSwr(module === undefined || module === "all" ? {} : { module })
    const { data, isLoading } = swrRead
    const error = readError(swrRead)
    const sources = useMemo(() => (data === undefined ? undefined : data.map((row) => toKnowledgeDocument(row))), [data])
    const live = useMemo(
        () =>
            Object.fromEntries(
                (sources ?? []).flatMap((source) => {
                    const state = liveOf(source)
                    return state === null ? [] : [[source.id, state]]
                }),
            ),
        [sources],
    )
    const truths = useMemo(
        () => Object.fromEntries((data ?? []).map((row) => [row.id, toDocumentTruths(row.truths)])),
        [data],
    )
    const slot = slotOfSwr({ data: sources, error: swrRead.error, isLoading })
    const reload = () => void swrRead.mutate()
    return { sources, live, truths, error, isLoading, slot, reload }
}
