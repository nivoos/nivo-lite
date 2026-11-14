import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { AGENTS_QUEUE, SETUP_TURN_JOB, type SetupTurnPayload } from "@modules/queues/agents"
import { RunSetupTurnStep } from "../../steps/run-setup-turn.step"

@Injectable()
/** The processor of the run-setup-turn job: the runner claims and settles it; `process` delegates the fenced claim to the one step. */
export class RunSetupTurnProcessor extends FencedProcessor {
    readonly queue: "agents" = AGENTS_QUEUE

    override readonly definition: JobDefinition<SetupTurnPayload> = SETUP_TURN_JOB

    constructor(private readonly step: RunSetupTurnStep) {
        super()
    }

    /** Runs the step; a stale token throws the fenced-out error from the guarded write before the effect and nothing else happens. */
    async process(job: ClaimedJob): Promise<void> {
        await this.step.run(job)
    }
}
