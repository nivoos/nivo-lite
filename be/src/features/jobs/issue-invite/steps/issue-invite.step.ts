import { Injectable } from "@nestjs/common"
import { InviteCommandsService } from "@modules/domain/workspace-invites"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: the invitation the web app asked for is created, sent again, linked or re-issued by the platform team, and the asker finds the answer on the command row. */
export class IssueInviteStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly commands: InviteCommandsService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "issue")
    }

    /** Serves the command after the worker's claim has been checked; the invitation's token and mail are keyed by the job. */
    protected perform(payload: object, job: ClaimedJob): Promise<unknown> {
        return this.commands.run(payload, job)
    }

    /** The job was dead-lettered: the command says the work stopped, so the asker stops waiting. */
    async stopped(payload: object): Promise<void> {
        await this.commands.stopped(payload)
    }
}
