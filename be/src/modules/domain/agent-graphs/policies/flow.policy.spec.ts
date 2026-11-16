import { Test } from "@nestjs/testing"
import type { GraphSpec, GraphSpecNode } from "@nivo-lite/agent-sdk/graph"
import { INSTALLED } from "@modules/domain/installed-plugins"
import { coreTemplates } from "@modules/domain/installed-plugins/installed-plugins.testing"
import { AgentGraphsError, AgentGraphsErrorCode } from "../errors/agent-graphs.error"
import { GRAPH_TEMPLATE_EDITED, flowChanged, requireSoundFlow, sameFlow } from "./flow.policy"
import { registerAppTriggerDeclarations } from "@tests/fixtures/builders/app-trigger-declarations"

// The installed graphs register on provider triggers: the booted api has every provider's declarations registered; so does this spec.
registerAppTriggerDeclarations()

/** The members of the subject under test. */
interface Subject {
    readonly sameFlow: typeof sameFlow
}

const SUBJECT = Symbol("flow.policy")

/** The policy functions, read through the Nest testing module. */
const build = async (): Promise<Subject> => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { sameFlow } }],
    }).compile()
    return moduleRef.get<Subject>(SUBJECT)
}

const NODE_A: GraphSpecNode = {
    key: "a",
    kind: "execute",
    step: "x",
    input: { text: { $ref: "trigger.text" }, list: [1, null, "b"] },
    next: "b",
}

const NODE_B: GraphSpecNode = { key: "b", kind: "output", step: "stop" }

const FLOW: GraphSpec = {
    schema: "nivo/agent-graph@1",
    moduleKey: "sales",
    trigger: { kind: "tag", sources: ["channel"] },
    grant: { tools: [], effects: [] },
    nodes: [NODE_A, NODE_B],
}

describe("sameFlow", () => {
    it("is false for a graph with no flow", async () => {
        const subject = await build()

        expect(subject.sameFlow(undefined, FLOW)).toBe(false)
    })

    it("is true for the same flow, whatever the order of the keys and an unset key", async () => {
        const subject = await build()
        const reordered: GraphSpec = {
            nodes: [
                {
                    next: "b",
                    step: "x",
                    kind: "execute",
                    key: "a",
                    params: undefined,
                    input: { list: [1, null, "b"], text: { $ref: "trigger.text" } },
                },
                { step: "stop", kind: "output", key: "b" },
            ],
            grant: { effects: [], tools: [], },
            trigger: { sources: ["channel"], kind: "tag" },
            moduleKey: "sales",
            schema: "nivo/agent-graph@1",
        }

        expect(subject.sameFlow(reordered, FLOW)).toBe(true)
    })

    it("is false when a value, a node or an element of a list differs", async () => {
        const subject = await build()
        expect(subject.sameFlow({ ...FLOW, moduleKey: "chatbot" }, FLOW)).toBe(false)
        expect(subject.sameFlow({ ...FLOW, nodes: [NODE_A] }, FLOW)).toBe(false)
        expect(
            subject.sameFlow(
                {
                    ...FLOW,
                    nodes: [{ ...NODE_A, input: { list: [1, null, "c"] } }, NODE_B],
                },
                FLOW,
            ),
        ).toBe(false)
    })
})

describe("flowChanged and requireSoundFlow", () => {
    it("tells a flow added, dropped or changed from one kept or never there", () => {
        expect(flowChanged(undefined, undefined)).toBe(false)
        expect(flowChanged(FLOW, undefined)).toBe(true)
        expect(flowChanged(undefined, FLOW)).toBe(true)
        expect(flowChanged(FLOW, { ...FLOW })).toBe(false)
    })
})

/** The refusal `requireSoundFlow` throws for a flow, or null when it passes. */
const refusalOf = (flow: GraphSpec): unknown => {
    try {
        requireSoundFlow(flow)
        return null
    } catch (cause) {
        return cause
    }
}

/** The problem codes of a refusal, as `requireSoundFlow` lists them. */
const problemsOf = (refused: unknown): string => (refused instanceof AgentGraphsError ? String(refused.params.problems) : "")

describe("requireSoundFlow: ONE graph format, an installed template version (GRAPH-CLEAN, owner ruling R89)", () => {
    const [template] = coreTemplates()
    if (template === undefined) throw new Error("the core package ships no template")
    const [version] = template.versions
    if (version === undefined) throw new Error("a template with no version")

    it("passes every version of every installed template as it is (every plugin of the installation)", () => {
        expect(INSTALLED.templates().length).toBeGreaterThan(coreTemplates().length - 1)
        const refused = INSTALLED.templates().flatMap((each) =>
            each.versions.flatMap((at) => (refusalOf(at.graph) === null ? [] : [`${each.id}@${String(at.version)}`])),
        )
        expect(refused).toEqual([])
    })

    it("refuses an edited copy (a step's params changed) as GRAPH_TEMPLATE_EDITED, writing nothing", () => {
        const [first, ...rest] = version.graph.nodes
        if (first === undefined) throw new Error("a template graph with no step")
        const edited: GraphSpec = { ...version.graph, nodes: [{ ...first, params: { edited: true } }, ...rest] }

        const refused = refusalOf(edited)

        expect(refused).toBeInstanceOf(AgentGraphsError)
        expect(refused).toMatchObject({ code: AgentGraphsErrorCode.PublishRefused })
        expect(problemsOf(refused)).toContain(`${GRAPH_TEMPLATE_EDITED} ${version.graph.moduleKey}`)
    })

    it("refuses a hand-made flow of node definitions as GRAPH_TEMPLATE_EDITED: no second set of checks judges it", () => {
        const refused = refusalOf({ ...FLOW, nodes: [{ key: "end", kind: "output", step: "stop" }] })

        expect(problemsOf(refused)).toBe(`${GRAPH_TEMPLATE_EDITED} sales`)
    })
})

describe("requireSoundFlow: an unstated mode is IMPOSSIBLE at save (nivo-frame `rights`: no engine default)", () => {
    // A raw stored document: its `mode` is any word as written (the SDK's type would refuse a bad one before the gate could).
    const sendOf = (extra: { readonly accounts: ReadonlyArray<never>; readonly mode?: string }): GraphSpecNode => {
        const node: GraphSpecNode = { key: "send", kind: "output", step: "stop", next: "b", accounts: extra.accounts }
        if (extra.mode !== undefined) Reflect.set(node, "mode", extra.mode)
        return node
    }
    const flowOf = (extra: { readonly accounts: ReadonlyArray<never>; readonly mode?: string }): GraphSpec => ({
        ...FLOW,
        nodes: [sendOf(extra), NODE_B],
    })

    it("refuses a node that carries the node contract (`accounts`) and states no mode, naming it", () => {
        const refused = refusalOf(flowOf({ accounts: [] }))
        expect(refused).toBeInstanceOf(AgentGraphsError)
        expect(problemsOf(refused)).toContain("NODE_MODE_UNSTATED send.mode")
    })

    it("refuses a mode that is neither `auto` nor `ask`", () => {
        const refused = refusalOf(flowOf({ accounts: [], mode: "never" }))
        expect(problemsOf(refused)).toContain("NODE_MODE_UNSTATED send.mode")
    })
})
