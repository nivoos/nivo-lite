import { Injectable } from "@nestjs/common"
import { WebhookEventsService } from "@modules/domain/webhook-connections"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: the signed delivery of one business event to one webhook connection. */
export class EmitWebhookEventStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly webhooks: WebhookEventsService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "deliver")
    }

    /** Delivers the event after the worker's claim has been checked; the POST is an effect keyed by the job. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.webhooks.deliver(job)
    }

    /** The job was dead-lettered: the connection shows why its deliveries stopped. */
    async failed(payload: object, cause: unknown): Promise<void> {
        await this.webhooks.deliveryFailed(payload, cause)
    }
}
