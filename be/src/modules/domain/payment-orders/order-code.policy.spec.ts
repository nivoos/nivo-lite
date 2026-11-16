import { Test } from "@nestjs/testing"
import { orderCodesIn } from "./order-code.policy"

type Subject = {
    orderCodesIn: typeof orderCodesIn
}

const SUBJECT = Symbol("order-code.policy")

const buildSubject = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { orderCodesIn } }],
    }).compile()
    return moduleRef.get<Subject>(SUBJECT)
}

describe("order code policy", () => {
    describe("orderCodesIn", () => {
        it("finds a code whatever the case, spaces and dashes the bank added", async () => {
            const subject = await buildSubject()

            expect(subject.orderCodesIn("nivo 8f3k2 - chuyen tien")).toEqual(["NIVO8F3K2"])
        })

        it("finds every distinct code across texts and ignores empty texts", async () => {
            const subject = await buildSubject()

            expect(subject.orderCodesIn(null, undefined, "NIVO8F3K2 NIVO8F3K2", "x NIVO23456 y")).toEqual([
                "NIVO8F3K2",
                "NIVO23456",
            ])
        })

        it("skips a prefix that is not followed by five readable characters", async () => {
            const subject = await buildSubject()

            expect(subject.orderCodesIn("NIVO1OL00", "NIVO", "NIVO8F3", "NIVO NIVO23456")).toEqual(["NIVO23456"])
        })

        it("answers nothing for a text without a code", async () => {
            const subject = await buildSubject()

            expect(subject.orderCodesIn("chuyen tien an trua")).toEqual([])
        })
    })
})
