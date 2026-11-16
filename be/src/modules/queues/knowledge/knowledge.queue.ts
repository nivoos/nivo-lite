import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import type {
    BrainWorkspaceUpkeepPayload,
    DossierReviewPayload,
    PolicyDerivePayload,
    PublicDraftPayload,
    KnowledgeSourcePayload,
} from "./knowledge.contracts"
import {
    DERIVE_POLICIES_JOB,
    DRAFT_PUBLIC_DOCUMENT_JOB,
    EXTRACT_FACTS_JOB,
    INDEX_SOURCE_JOB,
    REVIEW_DOSSIERS_JOB,
    RUN_BRAIN_COMMAND_JOB,
} from "./knowledge.jobs"

export { KNOWLEDGE_INDEX_QUEUE, KNOWLEDGE_QUEUE } from "./knowledge.contracts"

@Injectable()
/** The typed producer of the knowledge queue: the one way a knowledge job starts from the back end. */
export class KnowledgeQueue {
    constructor(@InjectQueueOutbox() private readonly outbox: QueueOutbox) {}

    /**
     * Enqueues the indexing of a source in the caller's transaction, on the index lane (`KNOWLEDGE_INDEX_QUEUE`); `retryAt` (epoch ms)
     * re-runs a source whose first job already ended.
     */
    enqueueIndex(payload: KnowledgeSourcePayload, tx: EntityManager, retryAt?: number): Promise<void> {
        const job: KnowledgeSourcePayload = retryAt === undefined ? payload : { ...payload, again: `retry:${String(retryAt)}` }
        return this.outbox.write(tx, INDEX_SOURCE_JOB.queue, job, { job: INDEX_SOURCE_JOB.name, dedupeKey: INDEX_SOURCE_JOB.onceKey(job) })
    }

    /** Enqueues the fact extraction of an indexed source in the caller's transaction; `runAt` (epoch ms) keys one reading per indexing, so a source indexed again is read again. */
    enqueueFacts(payload: KnowledgeSourcePayload, tx: EntityManager, runAt?: number): Promise<void> {
        const job: KnowledgeSourcePayload = runAt === undefined ? payload : { ...payload, again: `run:${String(runAt)}` }
        return this.outbox.write(tx, EXTRACT_FACTS_JOB.queue, job, { job: EXTRACT_FACTS_JOB.name, dedupeKey: EXTRACT_FACTS_JOB.onceKey(job) })
    }

    /**
     * Enqueues the follow-up of a facts job that read its budget of windows: the same reading goes on from the window it reached.
     * `step` (the text fingerprint and the windows read) keys it, so a retried job that reached the same point queues nothing twice.
     */
    enqueueFactsNext(payload: KnowledgeSourcePayload, tx: EntityManager, step: string): Promise<void> {
        const job: KnowledgeSourcePayload = { ...payload, again: `next:${step}` }
        return this.outbox.write(tx, EXTRACT_FACTS_JOB.queue, job, { job: EXTRACT_FACTS_JOB.name, dedupeKey: EXTRACT_FACTS_JOB.onceKey(job) })
    }

    /** Enqueues a run of the shop-document critic in the caller's transaction; one job per run row. */
    enqueueDossierReview(payload: DossierReviewPayload, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, REVIEW_DOSSIERS_JOB.queue, payload, { job: REVIEW_DOSSIERS_JOB.name, dedupeKey: REVIEW_DOSSIERS_JOB.onceKey(payload) })
    }

    /** Enqueues one document revision in the caller's transaction; a repeated enqueue is the same durable job. */
    enqueuePublicDraft(payload: PublicDraftPayload, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, DRAFT_PUBLIC_DOCUMENT_JOB.queue, payload, {
            job: DRAFT_PUBLIC_DOCUMENT_JOB.name,
            dedupeKey: DRAFT_PUBLIC_DOCUMENT_JOB.onceKey(payload),
        })
    }

    /**
     * Enqueues the upkeep of one workspace in the caller's transaction (the transaction that finishes the tick's job): one job per workspace
     * and tick minute.
     */
    enqueueBrainUpkeep(workspaceId: string, tx: EntityManager, at: number): Promise<void> {
        const payload: BrainWorkspaceUpkeepPayload = { upkeep: "workspace", workspaceId, at }
        return this.outbox.write(tx, RUN_BRAIN_COMMAND_JOB.queue, payload, { job: RUN_BRAIN_COMMAND_JOB.name, dedupeKey: RUN_BRAIN_COMMAND_JOB.onceKey(payload) })
    }

    /**
     * Enqueues one derive pass of a workspace's policies in the caller's transaction. `askedAt` (epoch ms) keys the pass: the
     * caller writes it only when no pass waits (the state row of the workspace says so), so a burst of fact changes is one job.
     */
    enqueuePolicyDerive(payload: PolicyDerivePayload, tx: EntityManager, askedAt: number): Promise<void> {
        const job: PolicyDerivePayload = { ...payload, askedAt }
        return this.outbox.write(tx, DERIVE_POLICIES_JOB.queue, job, { job: DERIVE_POLICIES_JOB.name, dedupeKey: DERIVE_POLICIES_JOB.onceKey(job) })
    }
}
