import type { MessageEvent } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { firstValueFrom, of, toArray } from "rxjs"
import { WorkspaceMembersService } from "@modules/domain/workspace-members"
import type { Principal } from "@modules/platform/cqrs"
import { JOB_PROGRESS_STREAM, type JobProgressStreamService } from "@modules/platform/jobs"
import { JobProgressAccessService } from "./job-progress-access.service"

const principal: Principal = { id: "person-1", role: "authenticated" }
const WS = "ws-1"
const FRAME: MessageEvent = { id: "f-1", data: { kind: "job" } }

const build = async () => {
    const members = mock<WorkspaceMembersService>()
    const progress = mock<JobProgressStreamService>()
    progress.open.mockReturnValue(of(FRAME))
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobProgressAccessService,
            { provide: WorkspaceMembersService, useValue: members },
            { provide: JOB_PROGRESS_STREAM, useValue: progress },
        ],
    }).compile()
    return { access: moduleRef.get(JobProgressAccessService), members, progress }
}

describe("JobProgressAccessService", () => {
    it("proves membership of the workspace, then opens the stream of the asked chains after the last event", async () => {
        const { access, members, progress } = await build()
        members.require.mockResolvedValue({} as never)

        const frames = await firstValueFrom(access.open(principal, WS, { root: "knowledge-source:s1" }, "f-0").pipe(toArray()))

        expect(members.require).toHaveBeenCalledWith("person-1", WS)
        expect(progress.open).toHaveBeenCalledWith({ workspaceId: WS, root: "knowledge-source:s1", roots: undefined }, "f-0")
        expect(frames).toEqual([FRAME])
    })

    it("refuses a non-member before anything is read", async () => {
        const { access, members, progress } = await build()
        members.require.mockRejectedValue(new Error("not a member"))

        await expect(firstValueFrom(access.open(principal, WS, {}))).rejects.toThrow("not a member")
        expect(progress.open).not.toHaveBeenCalled()
    })
})
