import { KnowledgeSourcesErrorCode, StoredNote } from "@modules/domain/knowledge-sources"
import { DocumentsErrorCode } from "@modules/integrations/documents"

/** The codes a source may store as the reason it failed: the notes of the capability, the codes of its sources and of the documents readers. */
const STORED: ReadonlySet<string> = new Set<string>([
    ...Object.values(StoredNote),
    ...Object.values(KnowledgeSourcesErrorCode),
    ...Object.values(DocumentsErrorCode),
])

/**
 * The stored code a dead letter's reason becomes on the source: the reason when it is one the front end words (a typed refusal carries
 * its note as its code), else `Unreadable`. It decides nothing about retrying: the runner classifies the failure before this is asked.
 */
export const storedNoteOf = (reason: unknown): string =>
    typeof reason === "string" && STORED.has(reason) ? reason : StoredNote.Unreadable
