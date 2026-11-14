"use client"

import { useJobProgress, useJobProgressWords } from "@/hooks/jobProgress"
import { QUERY_KNOWLEDGE_SOURCES_SWR_KEY } from "@/hooks/swr"
import { knowledgeJobRoot, knowledgeJobRootsOf } from "@/modules/documents"
import { jobStateOf, type JobStateView } from "@/modules/jobProgress"
import type { KnowledgeDocument } from "@/modules/types"

/** Where the chain of jobs on a source stands, as a row draws it; undefined when the stored status says it all. */
export type KnowledgeJobStateOf = (sourceId: string) => JobStateView | undefined

/**
 * Follows the job chains of the sources a worker is on (and the failed ones), all of them on one connection of the generic job-progress door, and gives each
 * source its state in plain words: the step with its count while it runs (reading the document, 3 of 12), when a retry runs, or that
 * it needs a person with the class of the failure. A finished chain says nothing here: the stored status is the settled word.
 */
export const useKnowledgeJobs = (sources: ReadonlyArray<KnowledgeDocument> | undefined): KnowledgeJobStateOf => {
    const words = useJobProgressWords()
    const progress = useJobProgress(knowledgeJobRootsOf(sources ?? []), QUERY_KNOWLEDGE_SOURCES_SWR_KEY)
    return (sourceId) => {
        const view = progress.of(knowledgeJobRoot(sourceId))
        return view.state === "done" ? undefined : (jobStateOf(view, words) ?? undefined)
    }
}
