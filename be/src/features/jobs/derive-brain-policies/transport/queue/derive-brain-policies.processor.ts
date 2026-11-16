import { Injectable } from "@nestjs/common"
import { BrainPolicyDeriveService } from "@modules/domain/brain"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { DERIVE_POLICIES_JOB, KNOWLEDGE_QUEUE, type PolicyDerivePayload } from "@modules/queues/knowledge"
import { DerivePoliciesStep } from "../../steps/derive-policies.step"

@Injectable()
/** The processor of the derive-brain-policies job: the runner claims and settles it; `process` delegates to the one step. */
export class DeriveBrainPoliciesProcessor extends FencedProcessor {
    override readonly queue: "knowledge" = KNOWLEDGE_QUEUE
    override readonly definition: JobDefinition<PolicyDerivePayload> = DERIVE_POLICIES_JOB

    constructor(
        private readonly derivePolicies: DerivePoliciesStep,
        private readonly derive: BrainPolicyDeriveService,
    ) {
        super()
    }

    /** Derives; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.derivePolicies.run(job)
    }

    /** The job was dead-lettered (one item for a person): the derive state of the workspace says so, for the tab; a resume runs a pass again. */
    override async onFailed(delivery: QueueDelivery): Promise<void> {
        await this.derive.failed(delivery.payload)
    }
}
