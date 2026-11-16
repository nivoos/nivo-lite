import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { INSTALLED } from "@modules/domain/installed-plugins"
import { AgentGraphsErrorCode } from "./errors/agent-graphs.error"
import { GRAPH_TEMPLATE_EDITED, flowProblemsOf, requireSoundFlow } from "./policies/flow.policy"
import { registerAppTriggerDeclarations } from "@tests/fixtures/builders/app-trigger-declarations"

// The installed graphs register on provider triggers: the booted api has every provider's declarations registered; so does this spec.
registerAppTriggerDeclarations()

// GRAPH-CLEAN (owner ruling R89: a stored graph is exactly an installed template version; no door edits it). Two rules, engine words:
// (1) nothing proposes a change to a graph, because no door can confirm one: no source writes, reads or names a graph proposal;
// (2) the store writes a workflow version only when it is an installed template version with the shop's node settings: ONE graph format,
//     every write road judged by the same template-copy rule, no second set of checks for a flow of node definitions.

/** The engine's source folders (the app and the domain), every TypeScript file but the specs. */
const ROOTS = [join(__dirname, "..", "..", ".."), join(__dirname, "..", "..", "..", "..", "apps")]

const sourcesOf = (root: string): ReadonlyArray<string> =>
    readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".spec.ts") && !file.includes("node_modules"))
        .map((file) => join(root, file))

const SOURCES = ROOTS.flatMap((root) => sourcesOf(root))

/** The source files that hold the text, by name relative to their root. */
const holding = (text: string): ReadonlyArray<string> =>
    SOURCES.filter((file) => readFileSync(file, "utf8").includes(text)).map((file) => file.replaceAll("\\", "/").split("/src/").at(-1) ?? file)

/** The refusal `requireSoundFlow` throws for a flow, or null when it passes. */
const refusalOf = (flow: GraphSpec): unknown => {
    try {
        requireSoundFlow(flow)
        return null
    } catch (cause) {
        return cause
    }
}

describe("GRAPH-CLEAN rule 1: nothing proposes a change to a graph", () => {
    it.each([
        // The table, its entity and the store members.
        "agent_graph_proposals",
        "AgentGraphProposal",
        "raiseProposal",
        "openProposalsOf",
        // The exposing kind: the watch tick's Brain comparison (it raised a conflict per replaced cited fact).
        "raiseConflict",
        "brainSourcesInForce",
        // The second kind: the setup apply's gaps (a sum the setup text states that the graph does not hold).
        "raiseGap",
        "proposeContracts",
        "unheldRules",
        // The source index only the comparison read.
        "agent_graph_sources",
    ])("no engine source names %s", (text) => {
        expect(holding(text)).toEqual([])
    })
})

describe("GRAPH-CLEAN rule 2: ONE graph format, an installed template version", () => {
    it("judges every write road by the one rule: the store, the agent graph publish and the flow publish call `requireSoundFlow`, the seed `flowProblemsOf`", () => {
        expect(holding("requireSoundFlow(").toSorted()).toEqual([
            "modules/domain/agent-graphs/agent-graph-flow.service.ts",
            "modules/domain/agent-graphs/agent-graph-publish.service.ts",
            "modules/domain/agent-graphs/agent-workflow-store.service.ts",
        ])
        // The checks of a flow of node definitions are no engine judgement any more.
        expect(holding("graphSpecProblems")).toEqual([])
        expect(holding("graphRefProblems")).toEqual([])
    })

    it("passes every installed template version as installed, and refuses the same graph with one step's params edited", () => {
        const versions = INSTALLED.templates().flatMap((template) => template.versions.map((version) => version.graph))
        expect(versions.length).toBeGreaterThan(0)
        expect(versions.flatMap((graph) => flowProblemsOf(graph))).toEqual([])
        const [graph] = versions
        const [first, ...rest] = graph?.nodes ?? []
        if (graph === undefined || first === undefined) throw new Error("no installed template graph with a step")

        const refused = refusalOf({ ...graph, nodes: [{ ...first, params: { ...first.params, edited: true } }, ...rest] })

        expect(refused).toMatchObject({
            code: AgentGraphsErrorCode.PublishRefused,
            params: { problems: expect.stringContaining(`${GRAPH_TEMPLATE_EDITED} ${graph.moduleKey}`) },
        })
    })

    it("refuses a flow of node definitions (the deleted format) by the same code, with no second set of checks", () => {
        const handMade: GraphSpec = {
            schema: "nivo/agent-graph@1",
            moduleKey: "sales",
            trigger: { kind: "tag", sources: ["channel"] },
            grant: { tools: [], effects: [] },
            nodes: [{ key: "end", kind: "output", step: "stop" }],
        }

        expect(flowProblemsOf(handMade)).toEqual([{ code: GRAPH_TEMPLATE_EDITED, at: "sales" }])
    })
})
