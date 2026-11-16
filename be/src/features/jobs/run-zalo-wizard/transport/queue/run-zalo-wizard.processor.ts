import { Injectable } from "@nestjs/common"
import { ZaloWizardService } from "@modules/domain/channels"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { RUN_ZALO_WIZARD_JOB, ZALO_WIZARD_QUEUE, type ZaloWizardPayload } from "@modules/queues/zalo-wizard"
import { WizardStep } from "../../steps/wizard.step"

@Injectable()
/**
 * The processor of the run-zalo-wizard job: the runner claims and settles it; `process` delegates the fenced claim to the one step. A failure
 * throws for the runner (the `waited` ladder, then one dead letter); at the dead letter the ticket the owner watches reads failed.
 */
export class RunZaloWizardProcessor extends FencedProcessor {
    override readonly queue: "zalo_wizard" = ZALO_WIZARD_QUEUE
    override readonly definition: JobDefinition<ZaloWizardPayload> = RUN_ZALO_WIZARD_JOB

    constructor(
        private readonly wizard: WizardStep,
        private readonly steps: ZaloWizardService,
    ) {
        super()
    }

    /** Runs the wizard command; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.wizard.run(job)
    }

    /** At the dead letter the ticket reads failed so the screen stops waiting; a resume runs the step again. */
    override async onFailed(delivery: QueueDelivery, _cause: unknown): Promise<void> {
        await this.steps.stopped(delivery.payload)
    }
}
