import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { parkedJobResumerProvider } from "@tests/fixtures/builders/stopped-work-providers.builder"
import { WorkspaceMemberSeatsService, type MemberSeatRecord } from "@modules/domain/workspace-members"
import { JOB_CLAIMS, type JobClaims, type ParkedJobResumerService } from "@modules/platform/jobs"
import { JobOpsError, JobOpsErrorCode } from "./errors/job-ops.error"
import { STOPPED_WORK_LIMIT } from "./stopped-work.contracts"
import { StoppedWorkService } from "./stopped-work.service"

const WS = "11111111-1111-4111-8111-111111111111"
const OTHER_WS = "99999999-9999-4999-8999-999999999999"
const OWNER = "22222222-2222-4222-8222-222222222222"
const MANAGER = "55555555-5555-4555-8555-555555555555"
const MINE = "44444444-4444-4444-8444-444444444444"
const THEIRS = "66666666-6666-4666-8666-666666666666"
const PARKED_AT = new Date("2026-11-14T10:00:00.000Z")

const PARKED = {
    jobId: MINE,
    job: "extract-knowledge-facts",
    failureClass: "input",
    reason: "KNOWLEDGE_SOURCE_UNREADABLE",
    parkedAt: PARKED_AT,
    resumeCount: 1,
} as const

/** The door over doubles: the job rows answer per workspace (a job of another workspace is never in this workspace's list). */
const build = async () => {
    const claims = mock<JobClaims>()
    claims.awaitingFix.mockImplementation((workspaceId) => Promise.resolve(workspaceId === WS ? [PARKED] : []))
    const resumer = mock<ParkedJobResumerService>()
    resumer.resume.mockResolvedValue(1)
    resumer.close.mockResolvedValue(true)
    const seats = mock<WorkspaceMemberSeatsService>()
    seats.activeSeatOfUser.mockImplementation((_workspaceId, userId) =>
        Promise.resolve(
            userId === OWNER
                ? mock<MemberSeatRecord>({ role: "owner" })
                : userId === MANAGER
                  ? mock<MemberSeatRecord>({ role: "manager" })
                  : null,
        ),
    )
    const moduleRef = await Test.createTestingModule({
        providers: [
            StoppedWorkService,
            { provide: JOB_CLAIMS, useValue: claims },
            parkedJobResumerProvider(resumer),
            { provide: WorkspaceMemberSeatsService, useValue: seats },
        ],
    }).compile()
    return { door: moduleRef.get(StoppedWorkService), claims, resumer }
}

const refusalOf = async (call: Promise<unknown>): Promise<unknown> => {
    try {
        await call
        return null
    } catch (cause) {
        return cause instanceof JobOpsError ? cause.code : cause
    }
}

describe("StoppedWorkService: the person's door to stopped work", () => {
    it("lists the workspace's parked jobs for its owner, the park time as ISO", async () => {
        const { door, claims } = await build()

        await expect(door.list(OWNER, WS)).resolves.toEqual([{ ...PARKED, parkedAt: "2026-11-14T10:00:00.000Z" }])

        expect(claims.awaitingFix).toHaveBeenCalledWith(WS, STOPPED_WORK_LIMIT)
    })

    it.each([
        ["a manager", MANAGER],
        ["someone with no seat", "77777777-7777-4777-8777-777777777777"],
    ])("%s may neither list, resume nor close: the owner's alone, nothing is touched", async (_who, userId) => {
        const { door, claims, resumer } = await build()

        expect(await refusalOf(door.list(userId, WS))).toBe(JobOpsErrorCode.StoppedWorkNeedsOwner)
        expect(await refusalOf(door.resume(userId, WS, MINE))).toBe(JobOpsErrorCode.StoppedWorkNeedsOwner)
        expect(await refusalOf(door.close(userId, WS, MINE, "why"))).toBe(JobOpsErrorCode.StoppedWorkNeedsOwner)

        expect(claims.awaitingFix).not.toHaveBeenCalled()
        expect(resumer.resume).not.toHaveBeenCalled()
        expect(resumer.close).not.toHaveBeenCalled()
    })

    it("resumes a parked job of the workspace through the resumer (a person's resume opens the next episode)", async () => {
        const { door, resumer } = await build()

        await expect(door.resume(OWNER, WS, MINE)).resolves.toBe(true)

        expect(resumer.resume).toHaveBeenCalledWith(MINE)
    })

    it("a job of ANOTHER workspace is refused as a job that is not parked: false, the resumer is never asked", async () => {
        const { door, resumer } = await build()

        await expect(door.resume(OWNER, OTHER_WS, THEIRS)).resolves.toBe(false)
        await expect(door.resume(OWNER, WS, THEIRS)).resolves.toBe(false)
        await expect(door.close(OWNER, WS, THEIRS, "not mine")).resolves.toBe(false)

        expect(resumer.resume).not.toHaveBeenCalled()
        expect(resumer.close).not.toHaveBeenCalled()
    })

    it("resume answers false when the job is no longer parked (another replica or a person got there first)", async () => {
        const { door, resumer } = await build()
        resumer.resume.mockResolvedValue(0)

        await expect(door.resume(OWNER, WS, MINE)).resolves.toBe(false)
    })

    it("closes a parked job of the workspace for good with the trimmed reason; false when it was no longer parked", async () => {
        const { door, resumer } = await build()

        await expect(door.close(OWNER, WS, MINE, "  the source was deleted  ")).resolves.toBe(true)
        expect(resumer.close).toHaveBeenCalledWith(MINE, "the source was deleted")

        resumer.close.mockResolvedValue(false)
        await expect(door.close(OWNER, WS, MINE, "again")).resolves.toBe(false)
    })

    it.each([["an empty reason", "   "], ["a reason over the limit", "x".repeat(501)]])(
        "%s closes nothing and says why",
        async (_name, reason) => {
            const { door, resumer } = await build()

            expect(await refusalOf(door.close(OWNER, WS, MINE, reason))).toBe(JobOpsErrorCode.StoppedWorkReasonInvalid)
            expect(resumer.close).not.toHaveBeenCalled()
        },
    )
})
