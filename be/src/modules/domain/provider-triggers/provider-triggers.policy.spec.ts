import { wakeContextOf } from "./provider-triggers.policy"

describe("the wake of a run", () => {
    it("carries the trigger, the account, the agent's part and the params only", () => {
        const wake = {
            providerTrigger: "sepay:transaction.received",
            connectionId: "conn-1",
            params: { transactionId: "tx-a", direction: "in" },
        }

        expect(wakeContextOf(wake, "notice")).toEqual({
            transactionId: "tx-a",
            direction: "in",
            providerTrigger: "sepay:transaction.received",
            connectionId: "conn-1",
            role: "notice",
        })
    })
})
