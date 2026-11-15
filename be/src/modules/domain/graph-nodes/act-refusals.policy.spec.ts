import { TOOL } from "@nivo-lite/agent-sdk/names"
import type { NodeHostPorts } from "@nivo-lite/agent-sdk/node"
import { mock } from "@starci/jest-preset"
import { actRefusalOf, actRefusalsKeptOf } from "./act-refusals.policy"
import { GraphNodesErrorCode } from "./errors/graph-nodes.error"

// E-FIX12 rule A-1 (D-W3-1): a typed refusal of a write OUTSIDE NIVO's database is a FAILED ACT (a stop), for every such tool; a refusal
// of a read or of a write inside NIVO's own records stays an answer the node decides on. Declarations only, no tool named by the rule.
describe("actRefusalOf", () => {
    it("the case that exposed it: the customer send refused by the channel (`not_delivered`) is a failed act naming the tool and its refusal", () => {
        const failed = actRefusalOf(TOOL.customerMessageSend, { ok: false, refusal: "not_delivered", facts: {} })
        expect(failed).toMatchObject({
            code: GraphNodesErrorCode.ActRefused,
            params: { effect: TOOL.customerMessageSend, outsideRefusal: "not_delivered" },
        })
        // The effect road's refused subject is the same answer.
        expect(actRefusalOf(TOOL.customerMessageSend, { kind: "refused", id: "outside_window", facts: {} })).toMatchObject({
            params: { outsideRefusal: "outside_window" },
        })
    })

    it("another kind of tool: a provider's invoice write refused (`rejected`) and a plugin's undeclared effect refused are failed acts too", () => {
        expect(actRefusalOf(TOOL.invoiceCreate, { ok: false, refusal: "rejected", facts: {} })).toMatchObject({
            code: GraphNodesErrorCode.ActRefused,
            params: { effect: TOOL.invoiceCreate, outsideRefusal: "rejected" },
        })
        expect(actRefusalOf("core.send", { kind: "refused", id: "nope" }, true)).toMatchObject({ code: GraphNodesErrorCode.ActRefused })
    })

    it("no failed act: a success, a refusal of a write inside NIVO's records, of a read, or an outcome-unknown code (its own road)", () => {
        expect(actRefusalOf(TOOL.customerMessageSend, { ok: true, value: {}, via: { provider: null, connectionId: null } })).toBeNull()
        expect(actRefusalOf(TOOL.recordCreate, { ok: false, refusal: "taken", facts: {} })).toBeNull()
        expect(actRefusalOf(TOOL.contactGet, { ok: false, refusal: "not_found", facts: {} })).toBeNull()
        expect(actRefusalOf(TOOL.customerMessageSend, { ok: false, refusal: "delivery_outcome_unknown", facts: {} })).toBeNull()
        // A plugin's read (its definition says it does not write) refused is an answer.
        expect(actRefusalOf("core.lookup", { kind: "refused", id: "nope" }, false)).toBeNull()
    })
})

describe("actRefusalOf: a refusal the tool declares FINAL for the subject is a business answer (E-FIX12 rule A-5)", () => {
    it("the customer send: consent withdrawn / no address at all are final (no stop); a closed window is not (a stop a person or time resolves)", () => {
        expect(actRefusalOf(TOOL.customerMessageSend, { ok: false, refusal: "customer_opted_out", facts: {} })).toBeNull()
        expect(actRefusalOf(TOOL.customerMessageSend, { kind: "refused", id: "no_recipient", facts: {} })).toBeNull()
        expect(actRefusalOf(TOOL.customerMessageSend, { ok: false, refusal: "outside_window", facts: {} })).toMatchObject({
            code: GraphNodesErrorCode.ActRefused,
        })
    })

    it("a second kind, a provider write: the domain registration's declared final `already_exists` is an answer; its `rejected` is a stop", () => {
        expect(actRefusalOf(TOOL.domainRegistrationCreate, { ok: false, refusal: "already_exists", facts: {} })).toBeNull()
        expect(actRefusalOf(TOOL.domainRegistrationCreate, { ok: false, refusal: "rejected", facts: {} })).toMatchObject({
            code: GraphNodesErrorCode.ActRefused,
            params: { effect: TOOL.domainRegistrationCreate, outsideRefusal: "rejected" },
        })
    })
})

describe("actRefusalsKeptOf", () => {
    it("keeps the failed act in `asks` and still hands the node the answer unchanged; other answers keep nothing", async () => {
        const ports = mock<NodeHostPorts>()
        const refused = { kind: "refused", id: "not_delivered", facts: {} }
        ports.execute.mockResolvedValueOnce(refused).mockResolvedValueOnce({ kind: "message", id: "m-1" })
        const asks: Array<Error> = []
        const kept = actRefusalsKeptOf(ports, asks)
        const effect = { id: TOOL.customerMessageSend } as unknown as Parameters<NodeHostPorts["execute"]>[0]

        await expect(kept.execute(effect, {}, { key: "run:send:a", dedupeKey: null })).resolves.toBe(refused)
        await expect(kept.execute(effect, {}, { key: "run:send:b", dedupeKey: null })).resolves.toEqual({ kind: "message", id: "m-1" })

        expect(asks).toHaveLength(1)
        expect(asks[0]).toMatchObject({ code: GraphNodesErrorCode.ActRefused })
    })
})
