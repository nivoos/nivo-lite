import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_GENERIC_WEBHOOK_JOB, GENERIC_WEBHOOK_QUEUE, type GenericWebhookPayload } from "@modules/queues/generic-webhook"
import { DeliverStep } from "../../steps/deliver.step"

/** How many events one process delivers at once: each wake is its own row under its own fact key, so deliveries do not wait on each other. */
const DELIVER_CONCURRENCY = 4

@Injectable()
/** The processor of the deliver job of the generic-webhook queue: the runner claims and settles it; `process` delegates to the one step. */
export class DeliverGenericWebhookProcessor extends FencedProcessor {
    override readonly queue: "generic_webhook" = GENERIC_WEBHOOK_QUEUE

    override readonly definition: JobDefinition<GenericWebhookPayload> = DELIVER_GENERIC_WEBHOOK_JOB

    override readonly concurrency: 4 = DELIVER_CONCURRENCY

    constructor(private readonly deliver: DeliverStep) {
        super()
    }

    /** Runs the step; a failure throws (the runner retries it on its ladder, then one dead letter); a stale token throws the fenced-out error before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.deliver.run(job)
    }
}
