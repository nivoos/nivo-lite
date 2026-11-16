import type { EntityManager } from "typeorm"
import { advisoryXactLock } from "./database.client"

/**
 * THE SUBJECT LOCK OF AN ENGINE STREAM (concept agent-data rule 12): a write that appends to a stream (a person's line on a route, a fact of
 * an append-only record type) takes the transaction lock of its (workspace, stream, subject) BEFORE the database hands it its sequence
 * number, and keeps it until its transaction ends. Two appends to one subject then commit in the order of their numbers, so a consumer that
 * read up to number N never finds, later, a committed item of the same subject numbered below N (the gap of a sequence-numbered log).
 * Appends to other subjects never wait on each other. One key shape for every stream.
 */
export const lockStreamSubject = (manager: EntityManager, workspaceId: string, stream: string, subject: string): Promise<void> =>
    advisoryXactLock(manager, `stream:${workspaceId}:${stream}:${subject}`)
