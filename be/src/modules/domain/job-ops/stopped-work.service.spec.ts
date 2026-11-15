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
const CLOSED = "88888888-8888-4888-8888-888888888888"
const RUNNING = "99999999-9999-4999-8999-999999999990"
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
    // What the workspace holds under an id: MINE is parked, CLOSED was closed, RUNNING is not stopped; any other id (or another workspace's) is missing.
    resumer.stateOf.mockImplementation((workspaceId, jobId) =>
        Promise.resolve(
            workspaceId !== WS ? "missing" : jobId === MINE ? "parked" : jobId === CLOSED ? "closed" : jobId === RUNNING ? "other" : "missing",
        ),
    )
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

    it("a job of ANOTHER workspace, or an id that never existed, is `not found`: the resumer is never asked to change anything", async () => {
        const { door, resumer } = await build()

        expect(await refusalOf(door.resume(OWNER, OTHER_WS, THEIRS))).toBe(JobOpsErrorCode.StoppedWorkNotFound)
        expect(await refusalOf(door.resume(OWNER, WS, THEIRS))).toBe(JobOpsErrorCode.StoppedWorkNotFound)
        expect(await refusalOf(door.close(OWNER, WS, THEIRS, "not mine"))).toBe(JobOpsErrorCode.StoppedWorkNotFound)

        expect(resumer.resume).not.toHaveBeenCalled()
        expect(resumer.close).not.toHaveBeenCalled()
    })

    it("a job a person already closed answers `already closed` to a second close AND to a resume, and changes nothing", async () => {
        const { door, resumer } = await build()

        expect(await refusalOf(door.close(OWNER, WS, CLOSED, "again"))).toBe(JobOpsErrorCode.StoppedWorkAlreadyClosed)
        expect(await refusalOf(door.resume(OWNER, WS, CLOSED))).toBe(JobOpsErrorCode.StoppedWorkAlreadyClosed)

        expect(resumer.resume).not.toHaveBeenCalled()
        expect(resumer.close).not.toHaveBeenCalled()
    })

    it("a job that exists but is not stopped (running, queued, done) answers `not stopped`", async () => {
        const { door } = await build()

        expect(await refusalOf(door.resume(OWNER, WS, RUNNING))).toBe(JobOpsErrorCode.StoppedWorkNotStopped)
        expect(await refusalOf(door.close(OWNER, WS, RUNNING, "why"))).toBe(JobOpsErrorCode.StoppedWorkNotStopped)
    })

    it("resume answers `not stopped` when the job stopped being parked between the look and the hand-back (another replica or a person got there first)", async () => {
        const { door, resumer } = await build()
        resumer.resume.mockResolvedValue(0)

        expect(await refusalOf(door.resume(OWNER, WS, MINE))).toBe(JobOpsErrorCode.StoppedWorkNotStopped)
    })

    it("closes a parked job of the workspace for good with the trimmed reason; `not stopped` when it was no longer parked", async () => {
        const { door, resumer } = await build()

        await expect(door.close(OWNER, WS, MINE, "  the source was deleted  ")).resolves.toBe(true)
        expect(resumer.close).toHaveBeenCalledWith(MINE, "the source was deleted")

        resumer.close.mockResolvedValue(false)
        expect(await refusalOf(door.close(OWNER, WS, MINE, "again"))).toBe(JobOpsErrorCode.StoppedWorkNotStopped)
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
