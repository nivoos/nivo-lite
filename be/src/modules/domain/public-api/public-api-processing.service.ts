import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { EventsService } from "@modules/domain/events"
import { ApiKnowledgeSourcesService } from "@modules/domain/knowledge-sources"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectInbox, type Inbox } from "@modules/platform/inbox"
import type { ClaimedJob, JobClaims, JobFenceService } from "@modules/platform/jobs"
import { InjectQueueOutbox, type QueueDelivery, type QueueOutbox } from "@modules/platform/queue"
import { PublicApiQueueJob, PUBLIC_API_QUEUE, SEND_PUBLIC_MESSAGE_JOB } from "@modules/queues/public-api"
import { PublicApiError, PublicApiErrorCode } from "./errors/public-api.error"
import { parsePublicApiBody, parsePublicApiJob } from "./public-api-job.policy"
import type { PublicApiJob } from "./public-api-job.contracts"
import type { PendingMessageDelivery } from "./public-api.contracts"
import { PublicApiLedgerService } from "./public-api-ledger.service"
import { PublicMessageFulfillmentService, type OptionalPreparedMessage, type PreparedMessage } from "./public-message-fulfillment.service"

/**
 * The prepared message the commit needs: PREPARE read the same unprocessed row (its payload never changes), so a message the commit finds
 * unprocessed was prepared; none means the row changed between the phases, a conflict the job runner judges.
 */
const preparedOf = (prepared: OptionalPreparedMessage): PreparedMessage => {
    if (prepared === null) throw new PublicApiError({ code: PublicApiErrorCode.InboxInconsistent })
    return prepared
}

@Injectable()
/**
 * Fulfills API admissions with inbox dedupe, domain writes and downstream jobs in one fence-held transaction. The reply a message owes
 * is written into the outbox in that same transaction as the send job (`public-api.send`): it commits with the request's completion or
 * not at all, and the send job (its own ladder and dead letter) makes the channel send through the delivery ledger.
 */
export class PublicApiProcessingService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectInbox() private readonly inbox: Inbox,
        private readonly knowledge: ApiKnowledgeSourcesService,
        private readonly messages: PublicMessageFulfillmentService,
        private readonly events: EventsService,
        private readonly ledger: PublicApiLedgerService,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
    ) {}

    /** Both historical implicit names and current named requests route through this queue's processor. */
    assertJobKind(kind: string): void {
        if (kind !== PublicApiQueueJob.Request && kind !== PUBLIC_API_QUEUE) {
            throw new PublicApiError({ code: PublicApiErrorCode.RequestInvalid, params: { field: "job" } })
        }
    }

    /** Advances the supported delivery and applies its effects under the caller's current job fence. */
    async processFenced(job: ClaimedJob, claims: JobClaims, fence: JobFenceService): Promise<void> {
        this.assertJobKind(job.kind)
        await claims.advance({
            jobId: job.jobId,
            expectedFencingToken: job.fencingToken,
            step: "public-api",
        })
        // PREPARE with no transaction open (concept outbox-job rule 12): the fence's transaction holds the job row and the request row,
        // so everything that reads through the pool or posts outside is done before it.
        const prepared = await this.prepare(job.payload)
        await fence.write(job, async (tx) => {
            const pending = await this.process(job.payload, tx, prepared)
            if (pending !== null) await this.queueSend(pending, tx)
        })
    }

    /**
     * PREPARE of a request, with no transaction open: for a message, its conversation, its sender and its hold (`PublicMessageFulfillmentService
     * .prepare`), from the request row as it stands (its payload never changes); nothing for knowledge, a missing row or one already
     * processed (the commit decides those on the locked row).
     */
    private async prepare(payload: object): Promise<OptionalPreparedMessage> {
        const job = parsePublicApiJob(payload)
        if (job.format === "knowledge") return null
        if (job.format === "message") return this.messages.prepare(job.workspaceId, job.identity, job.body, null, null)
        const row = await this.ledger.find(job.workspaceId, job.requestId, this.entityManager)
        if (row?.processedAt !== null) return null
        const request = parsePublicApiBody(row.kind, row.payload)
        if (request.kind !== "message") return null
        return this.messages.prepare(job.workspaceId, job.requestId, request.body, row.createdAt, row.keyId)
    }

    /**
     * The caller owns the live fence and supplies its transaction; no nested transaction may outlive it. Answers the send a message
     * owes, for the caller to enqueue in the same transaction (`processFenced` does).
     */
    async process(payload: object, tx: EntityManager, prepared: OptionalPreparedMessage): Promise<PendingMessageDelivery | null> {
        const job = parsePublicApiJob(payload)
        if (job.format === "ledger") return this.processRequest(job.workspaceId, job.requestId, tx, prepared)
        if (!(await this.inbox.claim(PUBLIC_API_QUEUE, `${job.workspaceId}:${job.format}:${job.identity}`, tx)))
            return null
        return this.processLegacy(job, tx, prepared)
    }

    /** Records terminal failure evidence while the standard transport retains and archives the original job. */
    async failDelivery(delivery: QueueDelivery): Promise<void> {
        let job: PublicApiJob
        try {
            job = parsePublicApiJob(delivery.payload)
        } catch (cause) {
            if (cause instanceof PublicApiError && cause.code === PublicApiErrorCode.RequestInvalid) return
            throw cause
        }
        await this.entityManager.transaction(async (tx) => {
            if (job.format === "ledger") {
                const row = await this.ledger.lock(job.workspaceId, job.requestId, tx)
                if (row?.processedAt !== null) return
            }
            if (!(await this.inbox.claim("public_api.failed", delivery.id, tx))) return
            await this.events.record(
                {
                    workspaceId: job.workspaceId,
                    kind: "api.failed",
                    actor: "NIVO",
                    summary: "Public API request exhausted its queue attempts; operator recovery is required",
                    evidence: delivery.id,
                },
                tx,
            )
        })
    }

    /** Writes the send job of a reply in the transaction that commits the request: once per send key, so a run again adds no second send. */
    private queueSend(pending: PendingMessageDelivery, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, PUBLIC_API_QUEUE, pending, {
            job: PublicApiQueueJob.Send,
            dedupeKey: SEND_PUBLIC_MESSAGE_JOB.onceKey(pending),
        })
    }

    private async processRequest(
        workspaceId: string,
        requestId: string,
        tx: EntityManager,
        prepared: OptionalPreparedMessage,
    ): Promise<PendingMessageDelivery | null> {
        const row = await this.ledger.lock(workspaceId, requestId, tx)
        if (row === null) throw new PublicApiError({ code: PublicApiErrorCode.RequestNotFound })
        if (row.processedAt !== null) return null
        const request = parsePublicApiBody(row.kind, row.payload)
        if (!(await this.inbox.claim(PUBLIC_API_QUEUE, `${workspaceId}:${requestId}`, tx))) {
            throw new PublicApiError({ code: PublicApiErrorCode.InboxInconsistent })
        }
        let pending: PendingMessageDelivery | null = null
        switch (request.kind) {
            case "knowledge":
                await this.knowledge.addText(
                    {
                        sourceId: requestId,
                        workspaceId,
                        ...request.body,
                        origin: request.body.source,
                    },
                    tx,
                )
                await this.events.record(
                    {
                        workspaceId,
                        kind: "api.knowledge",
                        actor: request.body.source,
                        summary: "Knowledge accepted through the API",
                        evidence: `source=${requestId} visibility=${request.body.visibility}`,
                    },
                    tx,
                )
                break
            case "message":
                pending = await this.messages.fulfill(workspaceId, requestId, request.body, preparedOf(prepared), tx)
                break
        }
        await this.ledger.complete(workspaceId, requestId, tx)
        return pending
    }

    private async processLegacy(
        job: Exclude<PublicApiJob, { format: "ledger" }>,
        tx: EntityManager,
        prepared: OptionalPreparedMessage,
    ): Promise<PendingMessageDelivery | null> {
        switch (job.format) {
            case "knowledge":
                await this.knowledge.indexExisting(job.workspaceId, job.sourceId, tx)
                return null
            case "message":
                return this.messages.fulfill(job.workspaceId, job.identity, job.body, preparedOf(prepared), tx, {
                    dedupeKey: job.dedupeKey,
                    recordEvidence: false,
                })
        }
    }
}
