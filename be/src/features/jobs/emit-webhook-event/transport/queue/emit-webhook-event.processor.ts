import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { EMIT_WEBHOOK_JOB, N8N_QUEUE, type N8nWebhookPayload } from "@modules/queues/n8n"
import { EmitWebhookEventStep } from "../../steps/deliver.step"

@Injectable()
/** The processor of the webhook delivery job: the runner claims and settles it; the one step posts the signed event to the connection. */
export class EmitWebhookEventProcessor extends FencedProcessor {
    override readonly queue: "n8n" = N8N_QUEUE
    override readonly definition: JobDefinition<N8nWebhookPayload> = EMIT_WEBHOOK_JOB

    constructor(private readonly step: EmitWebhookEventStep) {
        super()
    }

    /** Runs the one step; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.step.run(job)
    }

    /** The job was dead-lettered (one item for a person): the connection shows the reason; a resume posts the delivery again. */
    override async onFailed(delivery: QueueDelivery, cause: unknown): Promise<void> {
        await this.step.failed(delivery.payload, cause)
    }
}
