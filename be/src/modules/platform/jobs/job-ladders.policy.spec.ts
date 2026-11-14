import { Test } from "@nestjs/testing"
import { isPastLadder, JOB_LADDERS, ladderVerdictOf } from "./job-ladders.policy"

/** The policy as one subject, so a spec reads every export from the one built instance. */
class JobLaddersSubject {
    readonly JOB_LADDERS = JOB_LADDERS
    readonly ladderVerdictOf = ladderVerdictOf
    readonly isPastLadder = isPastLadder
}

const buildSubject = async (): Promise<JobLaddersSubject> => {
    const moduleRef = await Test.createTestingModule({ providers: [JobLaddersSubject] }).compile()
    return moduleRef.get(JobLaddersSubject)
}

describe("JOB_LADDERS", () => {
    it("declares the background ladder (4 starts, 5/10/20 s) and the waited ladder (5 starts, 1/2/4/8 min)", async () => {
        const { JOB_LADDERS: ladders } = await buildSubject()

        expect(ladders.background).toEqual({ starts: 4, pausesSeconds: [5, 10, 20] })
        expect(ladders.waited).toEqual({ starts: 5, pausesSeconds: [60, 120, 240, 480] })
    })

    it.each(["background", "waited"] as const)("keeps one pause for every start of the %s ladder but the last", async (name) => {
        const { JOB_LADDERS: ladders } = await buildSubject()

        expect(ladders[name].pausesSeconds).toHaveLength(ladders[name].starts - 1)
    })
})

describe("ladderVerdictOf", () => {
    it.each([
        [1, 5],
        [2, 10],
        [3, 20],
    ])("retries a transient failure on start %i of the background ladder after %i seconds", async (start, afterSeconds) => {
        const subject = await buildSubject()

        expect(subject.ladderVerdictOf(subject.JOB_LADDERS.background, start, true)).toEqual({ kind: "retry", afterSeconds })
    })

    it.each([
        [1, 60],
        [2, 120],
        [3, 240],
        [4, 480],
    ])("retries a transient failure on start %i of the waited ladder after %i seconds", async (start, afterSeconds) => {
        const subject = await buildSubject()

        expect(subject.ladderVerdictOf(subject.JOB_LADDERS.waited, start, true)).toEqual({ kind: "retry", afterSeconds })
    })

    it("dead-letters a transient failure on the last start, and on one past it", async () => {
        const subject = await buildSubject()

        expect(subject.ladderVerdictOf(subject.JOB_LADDERS.background, 4, true)).toEqual({ kind: "dead-letter", why: "exhausted" })
        expect(subject.ladderVerdictOf(subject.JOB_LADDERS.background, 9, true)).toEqual({ kind: "dead-letter", why: "exhausted" })
        expect(subject.ladderVerdictOf(subject.JOB_LADDERS.waited, 5, true)).toEqual({ kind: "dead-letter", why: "exhausted" })
    })

    it("dead-letters a failure that is not transient on the first start", async () => {
        const subject = await buildSubject()

        expect(subject.ladderVerdictOf(subject.JOB_LADDERS.waited, 1, false)).toEqual({ kind: "dead-letter", why: "class" })
    })
})

describe("isPastLadder", () => {
    it("is true only for a start beyond the ladder's last one: every earlier start died without settling", async () => {
        const subject = await buildSubject()

        expect(subject.isPastLadder(subject.JOB_LADDERS.background, 4)).toBe(false)
        expect(subject.isPastLadder(subject.JOB_LADDERS.background, 5)).toBe(true)
        expect(subject.isPastLadder(subject.JOB_LADDERS.waited, 5)).toBe(false)
        expect(subject.isPastLadder(subject.JOB_LADDERS.waited, 6)).toBe(true)
    })
})
