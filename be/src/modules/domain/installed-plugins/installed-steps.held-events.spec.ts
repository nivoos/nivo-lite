import { CALL_WORKFLOW_STEP } from "@nivo-lite/agent-sdk/graph"
import type { NodeDefinition } from "@nivo-lite/agent-sdk/node"
import { defineTemplateNode, type AnyTemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { INSTALLED } from "./installed.policy"
import { installedStepOf } from "./installed-steps.policy"

// SDK-DECL (E-FIX12 rule A-7): the installation's ONE step view answers whether a step's node declares it reads the events of the run's
// subject held behind the run. The engine asks it, never the node file: customer lines and records are one nature, the declaration
// names none. Fixture nodes only: the real install is read from the built packages, which carry the declaration after the one build.
const words = { vi: "Nút thử nghiệm của bộ kiểm tra.", en: "A test node of the checks." }

const node = (id: string, readsHeldEvents: true | undefined): AnyTemplateNode =>
    defineTemplateNode({
        id,
        title: { key: "t" },
        description: words,
        tools: [],
        mode: "auto",
        accounts: [],
        ...(readsHeldEvents === undefined ? {} : { readsHeldEvents }),
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        run: () => Promise.resolve({ ok: true }),
        examples: [{ name: "does its one thing", params: {}, input: {}, output: { ok: true } }],
    })

const NODES: ReadonlyMap<string, AnyTemplateNode> = new Map(
    [node("test.hear-lines", true), node("test.credit-batch", true), node("test.plain-step", undefined)].map((one) => [one.id, one]),
)

const lookups = {
    legacyNodeOf: (id: string): NodeDefinition | undefined => INSTALLED.nodeInstall().nodes.find((one) => one.id === id),
    templateNodeOf: (id: string): AnyTemplateNode | undefined => NODES.get(id),
    isEffect: () => false,
}

describe("installedStepOf: readsHeldEvents", () => {
    it("chat-shaped and a non-person subject (a bank transaction's credits): a node that declares it is read as declaring it", () => {
        expect(installedStepOf("test.hear-lines", lookups)?.readsHeldEvents).toBe(true)
        expect(installedStepOf("test.credit-batch", lookups)?.readsHeldEvents).toBe(true)
    })

    it("a node that declares nothing, and an engine control step (a `defineNode` node), read none: the safe side", () => {
        expect(installedStepOf("test.plain-step", lookups)?.readsHeldEvents).toBe(false)
        expect(installedStepOf(CALL_WORKFLOW_STEP, lookups)?.readsHeldEvents).toBe(false)
    })

    it("an id nobody installed is no step", () => {
        expect(installedStepOf("test.ghost", lookups)).toBeNull()
    })
})
