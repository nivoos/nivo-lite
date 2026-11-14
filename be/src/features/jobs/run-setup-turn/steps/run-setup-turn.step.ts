import { Injectable } from "@nestjs/common"
import { SetupTurnService } from "@modules/domain/modules"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: NIVO answers the owner message of the setup chat the payload names (one model call, the draft, the cards and the reply). */
export class RunSetupTurnStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly turns: SetupTurnService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "answer")
    }

    /** Answers the turn after the worker's claim has been checked; a turn answered already is recognised by its reply and left alone. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.turns.run(job)
    }
}
