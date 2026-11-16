import { Test } from "@nestjs/testing"
import { envelopeFactsOf } from "./stopped-events.policy"

const SUBJECT = Symbol("stopped-events.policy")
const WS = "11111111-1111-4111-8111-111111111111"

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { envelopeFactsOf } }],
    }).compile()
    return moduleRef.get<{ envelopeFactsOf: typeof envelopeFactsOf }>(SUBJECT)
}

describe("stopped-events.policy", () => {
    it("reads the id, the name and the workspace of an envelope", async () => {
        const policy = await build()

        expect(policy.envelopeFactsOf({ eventId: "e-1", eventName: "x.y", payload: { dedupeKey: "d", workspaceId: WS } })).toEqual({
            eventId: "e-1",
            eventName: "x.y",
            workspaceId: WS,
        })
    })

    it("answers no workspace when the payload names none or names a value that is no uuid", async () => {
        const policy = await build()

        expect(policy.envelopeFactsOf({ eventId: "e-1", eventName: "x.y", payload: { dedupeKey: "d" } })?.workspaceId).toBeNull()
        expect(policy.envelopeFactsOf({ eventId: "e-1", eventName: "x.y", payload: { workspaceId: "ws-1" } })?.workspaceId).toBeNull()
        expect(policy.envelopeFactsOf({ eventId: "e-1", eventName: "x.y" })?.workspaceId).toBeNull()
    })

    it.each([null, "text", { eventId: 42, eventName: "x" }, { eventId: "", eventName: "x" }, { eventId: "e-1" }])(
        "answers nothing for a message that is no event envelope: %p",
        async (message) => {
            const policy = await build()

            expect(policy.envelopeFactsOf(message)).toBeNull()
        },
    )
})
