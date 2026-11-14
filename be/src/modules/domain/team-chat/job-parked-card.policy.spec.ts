import { Test } from "@nestjs/testing"
import { jobParkedKind } from "@nivo-lite/agent-sdk/team-chat"
import {
    JOB_PARKED_MESSAGE_KIND,
    jobParkedCardViewOf,
    jobParkedKeyOf,
    jobParkedMessageOf,
    jobParkedPayloadOf,
    storedJobParkedOf,
} from "./job-parked-card.policy"

const SUBJECT = Symbol("job-parked-card.policy")

/** The policy as the providers of a testing module hand it out. */
const buildSubject = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { jobParkedCardViewOf, jobParkedKeyOf, jobParkedMessageOf, jobParkedPayloadOf, storedJobParkedOf } }],
    }).compile()
    return moduleRef.get<typeof import("./job-parked-card.policy")>(SUBJECT)
}

const JOB = "44444444-4444-4444-8444-444444444444"
const NOW = new Date("2026-11-14T10:00:00.000Z")
const REPORT = { jobId: JOB, job: "extract-knowledge-facts", failureClass: "config", reason: "MODEL_KEY_MISSING", episode: 2 } as const

describe("job-parked-card.policy", () => {
    it("the payload holds codes only and is a valid job.parked payload", async () => {
        const subject = await buildSubject()
        const payload = subject.jobParkedPayloadOf(REPORT, NOW)
        expect(payload).toEqual({
            version: 1,
            jobId: JOB,
            job: "extract-knowledge-facts",
            failureClass: "config",
            reason: "MODEL_KEY_MISSING",
            episode: 2,
            since: "2026-11-14T10:00:00.000Z",
        })
        expect(jobParkedKind.payload.safeParse(payload).success).toBe(true)
    })

    it("the message only tells: kind job.parked, intent notify, no one-tap reply", async () => {
        const subject = await buildSubject()
        const payload = subject.jobParkedPayloadOf(REPORT, NOW)
        expect(subject.jobParkedMessageOf(payload)).toEqual({
            kind: JOB_PARKED_MESSAGE_KIND,
            intent: "notify",
            title: "extract-knowledge-facts",
            summary: "extract-knowledge-facts · MODEL_KEY_MISSING",
            payload,
            options: [],
        })
        expect(JOB_PARKED_MESSAGE_KIND).toBe("job.parked")
    })

    it("one key per job and episode, within the column's 64 characters", async () => {
        const subject = await buildSubject()
        const key = subject.jobParkedKeyOf(JOB, 2)
        expect(key).toBe(`job-parked:${JOB}:2`)
        expect(key.length).toBeLessThanOrEqual(64)
        expect(subject.jobParkedKeyOf(JOB, 3)).not.toBe(key)
    })

    it("reads a stored card back as the view a screen reads (no version), and nothing from any other line", async () => {
        const subject = await buildSubject()
        const payload = subject.jobParkedPayloadOf(REPORT, NOW)
        const stored = JSON.stringify(subject.jobParkedMessageOf(payload))

        expect(subject.storedJobParkedOf(stored)).toEqual(payload)
        expect(subject.jobParkedCardViewOf(stored)).toEqual({
            jobId: JOB,
            job: "extract-knowledge-facts",
            failureClass: "config",
            reason: "MODEL_KEY_MISSING",
            episode: 2,
            since: "2026-11-14T10:00:00.000Z",
        })
        expect(subject.jobParkedCardViewOf(null)).toBeNull()
        expect(subject.jobParkedCardViewOf("not json")).toBeNull()
        expect(subject.jobParkedCardViewOf(JSON.stringify({ kind: "background.stopped", payload }))).toBeNull()
        expect(subject.jobParkedCardViewOf(JSON.stringify({ kind: "job.parked", payload: { version: 1, jobId: "no" } }))).toBeNull()
    })
})
