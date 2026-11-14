import { Injectable } from "@nestjs/common"
import { AgentGraphWatchService } from "@modules/domain/agent-graphs"
import { AdvancingJobStepPolicy, InjectJobClaims, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: seeds the graphs that are missing, raises what ended decisions teach, and compares the Brain rules behind the graphs. */
export class WatchAgentGraphsStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly watch: AgentGraphWatchService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "watch")
    }

    /** Runs the passes after the worker's claim has been checked. */
    protected perform(): Promise<unknown> {
        return this.watch.tick()
    }
}
