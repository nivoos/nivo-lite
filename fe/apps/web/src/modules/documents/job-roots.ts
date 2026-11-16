import type { KnowledgeDocument } from "@/modules/types"
import { isDocumentActive } from "./status"

/** The kind of the chain root the knowledge jobs of one source report under (`knowledge-source:<id>`). */
const KNOWLEDGE_ROOT_KIND = "knowledge-source"

/** The job-progress root of one source. */
export const knowledgeJobRoot = (sourceId: string): string => `${KNOWLEDGE_ROOT_KIND}:${sourceId}`

/** The sources the list follows live: the ones a worker is on and the failed ones (a dead letter names why), all of them: one stream carries every chain. */
export const knowledgeJobRootsOf = (sources: ReadonlyArray<KnowledgeDocument>): ReadonlyArray<string> =>
    sources
        .filter((source) => isDocumentActive(source.status) || source.status === "failed")
        .map((source) => knowledgeJobRoot(source.id))
