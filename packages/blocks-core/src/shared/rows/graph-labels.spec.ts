import { LEAD_FACTS } from "@nivo-lite/agent-sdk/node"
import { TRIGGER } from "@nivo-lite/agent-sdk/names"
import { TRIGGER_SOURCES } from "@nivo-lite/agent-sdk/graph"
import { z } from "zod"
import { corePlugin } from "../../plugin"
import { coreNodeViews } from "../nodes/node-lists"
import { nodeGoalOf, nodeSubtitleOf, nodeTitleOf } from "../nodes/node-ui"
import { TOOL_LABELS } from "../vocabulary/tool-labels"
import { PARAM_LABELS, TRIGGER_VERB_LABELS } from "./workflow-contract-view"

/*
 * The owner reads a node's drawer and never edits a graph, so the drawer explains everything and may never show a raw key. This spec is
 * the gap check: a member of a step's input or output, an outcome's output, a member a trigger supplies, a tool a node declares, a control
 * step, a trigger verb of an installed graph with no words fails here, so the gap cannot come back.
 */

const LOCALES = ["vi", "en"] as const

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** Every member name of a schema, at any depth (through lists, objects and nullable unions). */
const memberNamesOf = (schema: z.ZodType, io: "input" | "output"): ReadonlyArray<string> => {
    const names: Array<string> = []
    const walk = (node: unknown): void => {
        if (!isRecord(node)) return
        for (const option of [node.anyOf, node.oneOf, node.allOf]) if (Array.isArray(option)) option.forEach(walk)
        walk(node.items)
        if (isRecord(node.properties))
            for (const [name, member] of Object.entries(node.properties)) {
                names.push(name)
                walk(member)
            }
    }
    walk(z.toJSONSchema(schema, { io, unrepresentable: "any" }))
    return names
}

const graphs = (corePlugin.templateAgents ?? []).flatMap((agent) => agent.graphs)

/** Every name a drawer may print as a value's label, with the place it comes from. */
const memberPlaces = (): ReadonlyMap<string, Array<string>> => {
    const places = new Map<string, Array<string>>()
    const note = (name: string, where: string): void => {
        places.set(name, [...(places.get(name) ?? []), where])
    }
    for (const node of coreNodeViews) {
        for (const name of memberNamesOf(node.input, "input")) note(name, `${node.id} (in)`)
        for (const name of memberNamesOf(node.output, "output")) note(name, `${node.id} (out)`)
    }
    for (const graph of graphs) {
        for (const input of graph.spec.contract?.inputs ?? []) note(input.name, `${graph.key} (input)`)
        for (const outcome of graph.spec.outcomes ?? [])
            for (const output of outcome.outputs ?? []) note(output.name, `${graph.key} (outcome ${outcome.key})`)
        for (const node of graph.nodes.values()) {
            for (const name of memberNamesOf(node.input, "input")) note(name, `${node.id} (in)`)
            for (const name of memberNamesOf(node.output, "output")) note(name, `${node.id} (out)`)
        }
    }
    for (const source of Object.values(TRIGGER_SOURCES)) for (const param of source.supplies) note(param.name, "a trigger (supplies)")
    for (const fact of LEAD_FACTS) note(fact, "a lead fact")
    return places
}

describe("every member the drawer may print has words, in both languages", () => {
    const places = memberPlaces()

    it("covers a real set of members (the walk found the graphs)", () => {
        expect(graphs.length).toBeGreaterThan(5)
        expect(places.size).toBeGreaterThan(100)
    })

    it("has words for every member of every step's input and output, every outcome output and every member a trigger supplies", () => {
        const missing = [...places]
            .filter(([name]) => PARAM_LABELS[name] === undefined)
            .map(([name, where]) => `${name}: ${where.slice(0, 2).join("; ")}`)
        expect(missing).toEqual([])
    })

    it("words no member with its own key, and leaves no words blank", () => {
        for (const [name, words] of Object.entries(PARAM_LABELS)) {
            for (const locale of LOCALES) {
                expect(words[locale].trim()).not.toBe("")
                expect(words[locale]).not.toBe(name)
            }
        }
    })
})

describe("every tool a template node declares has words", () => {
    it("names each tool a node may call or requires, with a kind, a title and a summary in both languages", () => {
        const declared = new Set(graphs.flatMap((graph) => [...graph.nodes.values()].flatMap((node) => [...node.tools, ...(node.requires ?? [])])))
        expect(declared.size).toBeGreaterThan(5)
        const missing = [...declared].filter((tool) => TOOL_LABELS[tool] === undefined)
        expect(missing).toEqual([])
        for (const tool of declared) {
            const label = TOOL_LABELS[tool]
            for (const locale of LOCALES) {
                expect(label?.title[locale].trim()).not.toBe("")
                expect(label?.summary[locale].trim()).not.toBe("")
            }
        }
    })
})

describe("every control step and trigger of an installed graph has words", () => {
    it("titles every step a graph places and says what it is for, in both languages, never by its id (the loop frame is named by its graph)", () => {
        const steps = new Set(graphs.flatMap((graph) => graph.spec.nodes.map((node) => node.step)))
        expect(steps.size).toBeGreaterThan(5)
        for (const step of [...steps].filter((one) => one !== "core.loop")) {
            const view = coreNodeViews.find((node) => node.id === step)
            for (const locale of LOCALES) {
                expect(nodeTitleOf(view ?? { id: step }, locale)).not.toBe(step)
                expect(nodeTitleOf(view ?? { id: step }, locale).trim()).not.toBe("")
                expect(`${nodeGoalOf(step, locale)}${nodeSubtitleOf(step, locale)}`.trim()).not.toBe("")
            }
        }
    })

    it("words every trigger verb a graph registers on or waits for, as `<source> · <event>`, in both languages", () => {
        const verbs = new Set<string>()
        for (const graph of graphs) {
            for (const trigger of graph.spec.triggers) verbs.add(trigger.verb)
            for (const node of graph.spec.nodes) {
                const params: unknown = node.params
                const on: unknown = isRecord(params) ? params.on : undefined
                // Each key of a wait lists the verbs of its one meaning (concept templates rule 12).
                if (Array.isArray(on))
                    for (const one of on)
                        if (isRecord(one) && Array.isArray(one.verbs)) for (const verb of one.verbs) if (typeof verb === "string") verbs.add(verb)
            }
        }
        expect(verbs.size).toBeGreaterThan(5)
        const labelled: Readonly<Record<string, Readonly<Record<"vi" | "en", string>> | undefined>> = TRIGGER_VERB_LABELS
        const missing = [...verbs].filter((verb) => labelled[verb] === undefined)
        expect(missing).toEqual([])
        for (const words of Object.values(TRIGGER_VERB_LABELS)) for (const locale of LOCALES) expect(words[locale]).toContain(" · ")
        expect(Object.keys(TRIGGER_VERB_LABELS).sort()).toEqual(Object.values(TRIGGER).sort())
    })
})
