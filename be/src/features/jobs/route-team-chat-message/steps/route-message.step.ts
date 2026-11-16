import { Injectable } from "@nestjs/common"
import { TeamChatRouteService } from "@modules/domain/team-chat"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: the stored message the job names is routed, in the api (the one app that drives runs). */
export class RouteMessageStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly route: TeamChatRouteService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "route")
    }

    /** Routes the message after the worker's claim has been checked. */
    protected perform(payload: object, _job: ClaimedJob): Promise<unknown> {
        return this.route.routeJob(payload)
    }
}
