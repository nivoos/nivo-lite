import { isRecord } from "@modules/platform/primitives"

/** The foreign key of a passage to its document: a passage cannot be written for a document that is not there. */
const PASSAGE_SOURCE_KEY = "knowledge_chunks_source_id_fkey"

/** The SQLSTATE of a foreign key violation. */
const FOREIGN_KEY_VIOLATION = "23503"

/**
 * Whether a failed passage write says the DOCUMENT is gone (it was deleted while the job wrote): the database refused the write on the
 * passage's foreign key to the document. JOB-FRAME RULE (origin in force): the write is then not a failure but a typed end; the delete
 * and the write are serialised by that key itself (the write holds the document row until it commits).
 */
export const isSourceGone = (cause: unknown): boolean => {
    if (!isRecord(cause)) return false
    const driver = isRecord(cause.driverError) ? cause.driverError : cause
    return driver.code === FOREIGN_KEY_VIOLATION && driver.constraint === PASSAGE_SOURCE_KEY
}
