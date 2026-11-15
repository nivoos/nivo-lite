import type { AnyTemplateNode } from "@nivo-lite/agent-sdk/template"
import { plugin } from "../../plugin"

// SDK-DECL (E-FIX12 rule A-7): a node whose step does the CONSUMING read of the subject's stream (the run's queue `ctx.run.queue`, the
// person's lines read with `consume: true`) declares `readsHeldEvents`, so a visit of it after a person's decision may take the events
// held behind the run. A node that reads for context only, or not at all, declares nothing.
const DECLARING: ReadonlyArray<string> = ["webmail.hear"]

const nodes: ReadonlyArray<AnyTemplateNode> = [
    ...new Map(
        (plugin.templateAgents ?? [])
            .flatMap((agent) => agent.graphs.flatMap((graph) => [...graph.nodes.values()]))
            .map((node): readonly [string, AnyTemplateNode] => [node.id, node]),
    ).values(),
]

describe("the nodes that consume the subject's stream declare that they read its held events", () => {
    it("finds the package's nodes", () => {
        expect(nodes.length).toBeGreaterThan(0)
        for (const id of DECLARING) expect(nodes.map((node) => node.id)).toContain(id)
    })

    it.each(DECLARING)("%s declares it", (id) => {
        expect(nodes.find((node) => node.id === id)?.readsHeldEvents).toBe(true)
    })

    it("every other node declares nothing", () => {
        const others = nodes.filter((node) => !DECLARING.includes(node.id))
        expect(others.length).toBeGreaterThan(0)
        expect(others.filter((node) => node.readsHeldEvents !== undefined).map((node) => node.id)).toEqual([])
    })
})
