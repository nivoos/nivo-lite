import { Injectable } from "@nestjs/common"
import { WorkspaceMemberSeatsService } from "@modules/domain/workspace-members"
import { InjectJobClaims, InjectParkedJobResumer, type JobClaims, type ParkedJobResumerService } from "@modules/platform/jobs"
import { JobOpsError, JobOpsErrorCode } from "./errors/job-ops.error"
import { CLOSE_REASON_MAX, STOPPED_WORK_LIMIT, type StoppedWorkView } from "./stopped-work.contracts"

@Injectable()
/**
 * The person's door to stopped work (BE-JOBS-8): the founder lists the jobs of the workspace that parked for a fix, hands one back
 * ("resume now", which opens a new episode and so a new card if it stops again) or closes it for good with a reason. Only the
 * workspace owner may, and only a job whose payload names THIS workspace: another workspace's job answers false exactly as a job that
 * is not parked does, so an id of someone else's job tells nothing.
 */
export class StoppedWorkService {
    constructor(
        @InjectJobClaims() private readonly claims: JobClaims,
        @InjectParkedJobResumer() private readonly resumer: ParkedJobResumerService,
        private readonly seats: WorkspaceMemberSeatsService,
    ) {}

    /** The workspace's stopped jobs, oldest first. */
    async list(userId: string, workspaceId: string): Promise<ReadonlyArray<StoppedWorkView>> {
        await this.requireOwner(userId, workspaceId)
        const parked = await this.claims.awaitingFix(workspaceId, STOPPED_WORK_LIMIT)
        return parked.map((job) => ({ ...job, parkedAt: job.parkedAt.toISOString() }))
    }

    /** Hands one stopped job of the workspace back to its queue; false when it is not a parked job of this workspace. */
    async resume(userId: string, workspaceId: string, jobId: string): Promise<boolean> {
        await this.requireOwner(userId, workspaceId)
        if (!(await this.isParkedOf(workspaceId, jobId))) return false
        return (await this.resumer.resume(jobId)) > 0
    }

    /** Closes one stopped job of the workspace for good; false when it is not a parked job of this workspace. */
    async close(userId: string, workspaceId: string, jobId: string, reason: string): Promise<boolean> {
        await this.requireOwner(userId, workspaceId)
        const why = reason.trim()
        if (why === "" || why.length > CLOSE_REASON_MAX)
            throw new JobOpsError({ code: JobOpsErrorCode.StoppedWorkReasonInvalid, params: { max: CLOSE_REASON_MAX } })
        if (!(await this.isParkedOf(workspaceId, jobId))) return false
        return this.resumer.close(jobId, why)
    }

    private async isParkedOf(workspaceId: string, jobId: string): Promise<boolean> {
        const parked = await this.claims.awaitingFix(workspaceId, STOPPED_WORK_LIMIT)
        return parked.some((job) => job.jobId === jobId)
    }

    private async requireOwner(userId: string, workspaceId: string): Promise<void> {
        const seat = await this.seats.activeSeatOfUser(workspaceId, userId)
        if (seat?.role !== "owner") throw new JobOpsError({ code: JobOpsErrorCode.StoppedWorkNeedsOwner })
    }
}
