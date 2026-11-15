import { Test } from "@nestjs/testing"
import { QueueError, QueueErrorCode } from "@modules/platform/queue"
import { deadLetterCauseOf } from "./job-dead-letter-cause.policy"

const SUBJECT = Symbol("job-dead-letter-cause.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { deadLetterCauseOf } }],
    }).compile()
    return moduleRef.get<{ deadLetterCauseOf: typeof deadLetterCauseOf }>(SUBJECT)
}

const parked = (params: Record<string, string>, cause?: unknown): QueueError =>
    new QueueError({ code: QueueErrorCode.FlowFailure, params, cause })

describe("job-dead-letter-cause.policy", () => {
    it("reads the class and the reason the runner named, and keeps the failure itself", async () => {
        const policy = await build()
        const failure = new Error("the work threw this")

        expect(policy.deadLetterCauseOf(parked({ failureClass: "input", reason: "BILLING_FORBIDDEN" }, failure))).toEqual({
            failureClass: "input",
            reason: "BILLING_FORBIDDEN",
            failure,
        })
    })

    it("carries the stable CODE of a coded failure apart from the reason words, so a reader that maps codes never reads words", async () => {
        const policy = await build()
        const failure = Object.assign(new Error("BILLING_FORBIDDEN", { cause: new Error("driver words") }), {
            code: "BILLING_FORBIDDEN",
            params: { plan: "pro" },
        })
        const reason = "BILLING_FORBIDDEN (Error: driver words)"

        expect(policy.deadLetterCauseOf(parked({ failureClass: "input", reason }, failure))).toEqual({
            failureClass: "input",
            reason,
            code: "BILLING_FORBIDDEN",
            failure,
        })
    })

    it.each(["transient", "input", "code", "config"])("accepts the class %s", async (failureClass) => {
        const policy = await build()

        expect(policy.deadLetterCauseOf(parked({ failureClass, reason: "r" }))?.failureClass).toBe(failureClass)
    })

    it.each([
        { value: new Error("plain"), why: "an error that is not a flow failure" },
        { value: null, why: "nothing" },
        { value: parked({ failureClass: "nonsense", reason: "r" }), why: "a class the runner never names" },
        { value: parked({ failureClass: "input" }), why: "a reason that is missing" },
        { value: new QueueError({ code: QueueErrorCode.RetryAfter, params: { failureClass: "input", reason: "r" } }), why: "another queue error" },
    ])("answers nothing for $why", async ({ value }) => {
        const policy = await build()

        expect(policy.deadLetterCauseOf(value)).toBeUndefined()
    })
})
