import { Injectable } from "@nestjs/common"
import { AgentScheduleFireService } from "@modules/domain/agent-schedules"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: the slot that came up becomes one schedule wake on the one road. */
export class FireStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        @InjectJobClaims() claims: JobClaims,
        private readonly fires: AgentScheduleFireService,
    ) {
        super(claims, "fire")
    }

    /** Fires the slot after the worker's claim has been checked (a repeated slot writes no second wake, so the fence only keeps a stale worker from racing the fresh one): one domain method, the job passed down. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.fires.fire(job)
    }
}
