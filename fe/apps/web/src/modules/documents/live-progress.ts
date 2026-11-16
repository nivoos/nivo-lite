import type { KnowledgeDocument } from "@/modules/types"
import { isDocumentActive } from "./status"

/** The stages a worker moves a source through while it indexes it, in order. */
export type KnowledgeProgressStage = "read" | "chunk" | "embed" | "store" | "facts" | "critic"

/** Where a worker is on a document while it indexes it: the stage and how many passages of it are done. */
export interface LiveProgress {
    readonly stage: KnowledgeProgressStage | null
    /** Passages of the stage that are done, or null when the stage has no count. */
    readonly done: number | null
    /** Passages of the stage in all, or null when the stage has no count. */
    readonly total: number | null
    /** 0 to 100. */
    readonly percent: number
}

/** The processing row of one document with every word resolved. */
export interface KnowledgeProgressRowView {
    /** What is going on: "Dang xu ly". */
    readonly title: string
    /** The stage a worker is on. */
    readonly stage: string
    /** How many passages of the stage are done, or null when the stage has no count. */
    readonly count: string | null
    /** 0 to 100. */
    readonly value: number
    /** What the bar measures, for assistive technology. */
    readonly label: string
}

/** The catalog key (`knowledge` namespace) of the name of each stage. */
export const KNOWLEDGE_STAGE_KEYS: Readonly<Record<KnowledgeProgressStage, string>> = {
    read: "stage_read",
    chunk: "stage_chunk",
    embed: "stage_embed",
    store: "stage_store",
    facts: "stage_facts",
    critic: "stage_critic",
}

/** The stage a stored text names, or null for none or one this page does not know. */
const stageOf = (value: string | null): KnowledgeProgressStage | null =>
    value === "read" ||
    value === "chunk" ||
    value === "embed" ||
    value === "store" ||
    value === "facts" ||
    value === "critic"
        ? value
        : null

/** What a worker is doing on a document as the stored list says, or null when no worker is on it. */
export const liveOf = (document: KnowledgeDocument): LiveProgress | null =>
    isDocumentActive(document.status)
        ? {
              stage: stageOf(document.stage),
              done: document.stageDone,
              total: document.stageTotal,
              percent: document.progress,
          }
        : null
