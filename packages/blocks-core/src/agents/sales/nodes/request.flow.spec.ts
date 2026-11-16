import { PROVIDER, TOOL } from "@nivo-lite/agent-sdk/names"
import type { TemplateNode } from "@nivo-lite/agent-sdk/template"
import { checkTemplateNode } from "@nivo-lite/agent-sdk/testing"
import { salesRequestCancelNode } from "./request-cancel.node"
import { salesRequestPayNode } from "./request-pay.node"
import { salesRequestReadNode } from "./request-read.node"

// The payment request of the sale (owner ruling R111): ask to pay, read the request at every wake, withdraw it at a cancel. ONE tool family
// whichever money provider the account is: `checkTemplateNode` runs every example of a node with no engine and checks its definition; the
// examples of `sales.request-pay` are a payOS account (a request kept) and a SePay account (none kept) through the same node and call.

const STEPS: ReadonlyArray<TemplateNode> = [salesRequestPayNode, salesRequestReadNode, salesRequestCancelNode]

describe.each(STEPS.map((step) => [step.id, step] as const))("%s", (_id, step) => {
    it("passes its definition checks and every example", async () => {
        expect(await checkTemplateNode(step)).toEqual([])
    })

    it("is automatic, lists the money providers in one order and names no other payment tool", () => {
        expect(step.mode).toBe("auto")
        expect(step.accounts).toEqual([PROVIDER.payos, PROVIDER.sepay])
        const payments = step.tools.filter((tool) => tool.startsWith("nivo.tool.payment."))
        expect(payments.every((tool) => tool.startsWith("nivo.tool.payment.request."))).toBe(true)
    })
})

describe("sales.request-pay: one node, one call, both kinds of provider", () => {
    const calls = salesRequestPayNode.examples.map((example) => example.tools?.[0])

    it("makes the same call for a payOS and a SePay account: the order's exact total and its code", () => {
        const asked = calls.filter((call) => call?.id === TOOL.paymentRequestCreate).map((call) => JSON.stringify(call?.args))
        expect(new Set(asked).size).toBe(1)
    })

    it("keeps the request's reference on the order only when the provider keeps a request", () => {
        for (const example of salesRequestPayNode.examples) {
            if (!("output" in example)) continue
            const output = example.output as { readonly requestRef: string | null }
            const wrote = (example.tools ?? []).some((call) => call.id === TOOL.recordUpdate)
            expect(wrote).toBe(output.requestRef !== null)
        }
    })

    it("stops on a refused request (no account connected, or the provider refused)", () => {
        const failures = salesRequestPayNode.examples.flatMap((example) => (JSON.stringify("failure" in example ? example.failure : null).match(/"why":"([^"]*)"/u)?.slice(1) ?? []))
        expect(failures).toEqual([`${TOOL.paymentRequestCreate} refused: not_connected`, `${TOOL.paymentRequestCreate} refused: rejected`])
    })
})

describe("sales.request-cancel: withdraws only what can still be paid", () => {
    it("reads before it cancels, and cancels only an open request", () => {
        for (const example of salesRequestCancelNode.examples) {
            const ids = (example.tools ?? []).map((call) => call.id)
            if (ids.includes(TOOL.paymentRequestCancel)) expect(ids.indexOf(TOOL.paymentRequestGet)).toBeLessThan(ids.indexOf(TOOL.paymentRequestCancel))
        }
    })
})
