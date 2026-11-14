import { Test } from "@nestjs/testing"
import { QueueError, QueueErrorCode } from "@modules/platform/queue"
import type { ClaimedJob } from "./jobs.contracts"
import { defineJob } from "./job-definition"
import { payloadOfJob } from "./job-payload.policy"

interface Named {
    readonly name: string
}

const job = defineJob<Named>({
    name: "x.act",
    queue: "x",
    ladder: "background",
    payload: (value): value is Named => typeof value === "object" && value !== null && "name" in value && typeof value.name === "string",
    onceKey: (payload) => payload.name,
    next: [],
    effects: [],
})

const SUBJECT = Symbol("job-payload.policy")

const claimed = (payload: object): ClaimedJob => ({ jobId: "job-1", kind: "x.act", fencingToken: 1, currentStep: null, payload })

/** The policy as Nest hands it to a caller. */
const build = async () => {
    const moduleRef = await Test.createTestingModule({ providers: [{ provide: SUBJECT, useValue: { payloadOfJob } }] }).compile()
    return moduleRef.get<{ payloadOfJob: typeof payloadOfJob }>(SUBJECT)
}

describe("job payload policy", () => {
    it("answers the payload of a claimed job typed as its declaration says", async () => {
        const policy = await build()

        expect(policy.payloadOfJob(job, claimed({ name: "a" }))).toEqual({ name: "a" })
    })

    it("refuses a payload the declaration does not accept as a flow failure of class input, as the runner does", async () => {
        const policy = await build()

        const thrown = (() => {
            try {
                return policy.payloadOfJob(job, claimed({ other: 1 }))
            } catch (cause) {
                return cause
            }
        })()

        expect(thrown).toBeInstanceOf(QueueError)
        expect(thrown).toMatchObject({ code: QueueErrorCode.FlowFailure, params: { failureClass: "input", reason: "payload refused: x.act" } })
    })
})
