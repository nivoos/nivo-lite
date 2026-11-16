import { Injectable } from "@nestjs/common"
import { PublicDraftRunService } from "@modules/domain/public-documents"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { DRAFT_PUBLIC_DOCUMENT_JOB, KNOWLEDGE_QUEUE, type PublicDraftPayload } from "@modules/queues/knowledge"
import { DraftPublicDocumentStep } from "../../steps/draft-public-document.step"

@Injectable()
/** The processor of the draft-public-document job (`DRAFT_PUBLIC_DOCUMENT_JOB`): the runner claims and settles it; `process` delegates to the one step. */
export class DraftPublicDocumentProcessor extends FencedProcessor {
    override readonly queue: "knowledge" = KNOWLEDGE_QUEUE
    override readonly definition: JobDefinition<PublicDraftPayload> = DRAFT_PUBLIC_DOCUMENT_JOB

    constructor(
        private readonly draftDocument: DraftPublicDocumentStep,
        private readonly drafts: PublicDraftRunService,
    ) {
        super()
    }

    /** Drafts the document; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.draftDocument.run(job)
    }

    /** The job was dead-lettered (one item for a person): the document says the draft could not be made, whoever asked; a resume drafts it again. */
    override async onFailed(delivery: QueueDelivery): Promise<void> {
        await this.drafts.fail(delivery.payload)
    }
}
