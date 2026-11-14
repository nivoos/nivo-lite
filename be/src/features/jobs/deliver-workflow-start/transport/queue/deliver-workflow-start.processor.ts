import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_WORKFLOW_START_JOB, WORKFLOW_START_QUEUE, type WorkflowStartPayload } from "@modules/queues/workflow-start"
import { DeliverStartStep } from "../../steps/deliver-start.step"

/** How many starts one process delivers at once: each is its own event under its own once-key, so they do not wait on each other. */
const DELIVER_CONCURRENCY = 4

@Injectable()
/** The processor of the deliver job of the workflow-start queue: the runner claims and settles it; `process` delegates to the one step. */
export class DeliverWorkflowStartProcessor extends FencedProcessor {
    override readonly queue: "workflow_start" = WORKFLOW_START_QUEUE

    override readonly definition: JobDefinition<WorkflowStartPayload> = DELIVER_WORKFLOW_START_JOB

    override readonly concurrency: 4 = DELIVER_CONCURRENCY

    constructor(private readonly deliver: DeliverStartStep) {
        super()
    }

    /** Runs the step; a start nobody took throws (the runner dead-letters it with one item); a stale token throws the fenced-out error before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.deliver.run(job)
    }
}
