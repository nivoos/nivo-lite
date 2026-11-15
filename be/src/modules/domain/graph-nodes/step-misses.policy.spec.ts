import { TOOL } from "@nivo-lite/agent-sdk/names"
import { missOfAnswer, withMiss, type StepMiss } from "./step-misses.policy"

// R68 narrowed by E-FIX12 rule A-1: the only miss a call answers is a person's `declined`; a refused write is no business ending.
describe("step-misses.policy", () => {
    it("a declined approval is a miss of ANY tool, in either form of the answer", () => {
        expect(missOfAnswer(TOOL.teamMessagePost, { ok: false, refusal: "declined", facts: { tool: TOOL.teamMessagePost } })).toEqual({
            kind: "declined",
            tool: TOOL.teamMessagePost,
        })
        expect(missOfAnswer(TOOL.customerMessageSend, { kind: "refused", id: "declined", facts: {} })).toMatchObject({ kind: "declined" })
    })

    it("a refusal the tool declares FINAL for the subject is a business miss with its code (E-FIX12 A-5), in either form, of any tool", () => {
        expect(missOfAnswer(TOOL.customerMessageSend, { kind: "refused", id: "customer_opted_out", facts: {} })).toEqual({
            kind: "refused",
            tool: TOOL.customerMessageSend,
            refusal: "customer_opted_out",
        })
        expect(missOfAnswer(TOOL.domainRegistrationCreate, { ok: false, refusal: "already_exists", facts: {} })).toMatchObject({
            kind: "refused",
            refusal: "already_exists",
        })
    })

    it("any other refusal, of a read or of a write, is no miss: a refused write outside is a failed act (a stop), not a business end", () => {
        expect(missOfAnswer(TOOL.customerMessageSend, { ok: false, refusal: "not_delivered", facts: {} })).toBeNull()
        expect(missOfAnswer(TOOL.domainRegistrationCreate, { ok: false, refusal: "rejected", facts: {} })).toBeNull()
        expect(missOfAnswer(TOOL.contactGet, { ok: false, refusal: "not_found", facts: {} })).toBeNull()
        expect(missOfAnswer(TOOL.contactGet, { contactId: "c1" })).toBeNull()
    })

    it("the same miss answered twice (a replay, an agent's repeat) is kept once, in call order", () => {
        const misses: Array<StepMiss> = []
        withMiss(misses, missOfAnswer(TOOL.teamMessagePost, { ok: false, refusal: "declined", facts: {} }))
        withMiss(misses, missOfAnswer(TOOL.teamMessagePost, { ok: false, refusal: "declined", facts: {} }))
        withMiss(misses, null)
        withMiss(misses, missOfAnswer(TOOL.customerMessageSend, { ok: false, refusal: "declined", facts: {} }))
        expect(misses.map((one) => one.tool)).toEqual([TOOL.teamMessagePost, TOOL.customerMessageSend])
    })
})
