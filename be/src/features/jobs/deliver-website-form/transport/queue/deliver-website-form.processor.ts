import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_WEBSITE_FORM_JOB, WEBSITE_FORM_QUEUE, type WebsiteFormPayload } from "@modules/queues/website-form"
import { DeliverSubmissionStep } from "../../steps/deliver-submission.step"

/** How many submissions one process delivers at once: each is its own event under its own once-key, so they do not wait on each other. */
const DELIVER_CONCURRENCY = 4

@Injectable()
/** The processor of the deliver job of the website-form queue: the runner claims and settles it; `process` delegates to the one step. */
export class DeliverWebsiteFormProcessor extends FencedProcessor {
    override readonly queue: "website_form" = WEBSITE_FORM_QUEUE

    override readonly definition: JobDefinition<WebsiteFormPayload> = DELIVER_WEBSITE_FORM_JOB

    override readonly concurrency: 4 = DELIVER_CONCURRENCY

    constructor(private readonly deliver: DeliverSubmissionStep) {
        super()
    }

    /** Runs the step; a stale token throws the fenced-out error from the guarded write before the effect and nothing else happens. */
    async process(job: ClaimedJob): Promise<void> {
        await this.deliver.run(job)
    }
}
