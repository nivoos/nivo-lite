import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import {
    installed,
    nodeGoalOf,
    toolLabelOf,
    triggerViewsOf,
    type GraphNodeView,
    type GraphView,
    type ParamField,
} from "@/modules/plugin-registry"
import type { StepDrawerView, StepFactRowView, StepFactSectionView, StepsMapView } from "@/modules/types"
import { bindingRowsOf, callRowOf, outputRowsOf } from "./workflowContractDrawer"
import { TRIGGER_KEY } from "./workflowKeys"
import type { RefWords } from "./workflowRefLabels"
import { WAIT_STEP, waitFactsOf } from "./workflowMap"

/*
 * The READ ONLY explanation of a step (a workflow's graph is exactly its template's; a shop edits no graph): one section per fact, each
 * a list of rows of label, value and a muted helper. Every word is a label (the node's, the tool's, the package's, the graph's own),
 * never a key. A section with nothing to show is not built. The order is the drawer's: what the step does, when it runs, what goes in,
 * what comes out, the tools it calls, where it goes next, the workflow a hand-off calls.
 */

/** The two languages of the drawer. */
type ExplainLocale = "vi" | "en"

/** The words of the explanation that are the app's own. */
export interface ExplainWords extends RefWords {
    readonly locale: ExplainLocale
    readonly required: string
    readonly titles: Readonly<Record<"what" | "when" | "inputs" | "outputs" | "tools" | "exits" | "call", string>>
    /** The label of a data param that comes from another step ("taken from"). */
    readonly fromLabel: string
    /** The label of a data param whose value is written in the graph ("fixed value"). */
    readonly fixedLabel: string
    /** What a wait waits for. */
    readonly waitsFor: string
    /** The longest a wait waits. */
    readonly waitLimit: string
    /** The words of a trigger that takes every wake of its source. */
    readonly everyEvent: string
    /** What a trigger supplies, as a line with its members. */
    readonly supplies: (members: string) => string
    readonly toolActs: string
    readonly toolReads: string
    readonly exitNext: string
    readonly exitBack: string
    readonly callTarget: string
    readonly yes: string
    readonly no: string
    /** A number setting in the reader's language: money in dong, a duration with its unit. */
    readonly number: (value: number, input: string, unit: string | undefined) => string
}

/** What the explanation of a step is drawn from. */
export interface ExplainInput {
    readonly spec: GraphSpec | null
    readonly graph: GraphView
    readonly map: StepsMapView
    readonly nodeKey: string
}

const UNITS: Readonly<Record<NonNullable<ParamField["unit"]>, string>> = { minutes: "minute", hours: "hour", days: "day" }

/** The label of a member, or the word of an unnamed value when the package has no label for it (it then answers the raw name). */
const labelOf = (label: string, name: string, words: ExplainWords): string =>
    label === name || label === name.split(".").at(-1) ? words.unnamed : label

const section = (id: string, title: string, rows: ReadonlyArray<StepFactRowView>): ReadonlyArray<StepFactSectionView> =>
    rows.length === 0 ? [] : [{ id, title, rows }]

/** The value of a setting as words: a choice by its label, a switch as yes / no, a number through the formatter, a text as it is. */
const settingTextOf = (field: ParamField, words: ExplainWords): string => {
    const value: unknown = field.value
    if (value === undefined || value === null || value === "") return ""
    if (typeof value === "boolean") return value ? words.yes : words.no
    if (typeof value === "number")
        return words.number(value, field.input, field.unit === undefined ? undefined : UNITS[field.unit])
    if (typeof value === "string") return field.options?.find((option) => option.value === value)?.label ?? value
    return ""
}

/** The first section, what the step does: the step's goal in one sentence (the package's), else its line. */
const whatOf = (node: GraphNodeView, words: ExplainWords): ReadonlyArray<StepFactSectionView> => {
    const goal = node.step === undefined ? "" : nodeGoalOf(node.step, words.locale)
    const text = [goal, node.subtitle ?? "", node.description ?? ""].find((one) => one !== "") ?? ""
    return section("what", words.titles.what, text === "" ? [] : [{ id: "what", label: node.title ?? node.label, value: text, helper: "" }])
}

/** When it runs: the sources that start the workflow (the trigger step), or what a wait waits for and for how long. */
const whenOf = (spec: GraphSpec, node: GraphNodeView, words: ExplainWords): ReadonlyArray<StepFactSectionView> => {
    if (node.id === TRIGGER_KEY)
        return section(
            "when",
            words.titles.when,
            triggerViewsOf(spec, words.locale).map((trigger) => ({
                id: trigger.key,
                label: trigger.sourceLabel,
                value: trigger.conditions.length === 0 ? words.everyEvent : trigger.conditions.map((one) => one.label).join(" · "),
                helper: trigger.params.length === 0 ? "" : words.supplies(trigger.params.map((param) => param.label).join(", ")),
            })),
        )
    if (node.step !== WAIT_STEP) return []
    const facts = waitFactsOf(node, words.locale)
    return section("when", words.titles.when, [
        ...(facts.events.length === 0 ? [] : [{ id: "waits", label: words.waitsFor, value: facts.events.join(", "), helper: "" }]),
        ...(facts.limit === "" ? [] : [{ id: "limit", label: words.waitLimit, value: facts.limit, helper: "" }]),
    ])
}

/** The rows of what a step takes in: each data param (where it comes from, or its fixed value) and each setting of the step as a fixed value. */
const inputRowsOf = (spec: GraphSpec, node: GraphNodeView, words: ExplainWords): ReadonlyArray<StepFactRowView> => {
    const bindings = bindingRowsOf(spec, node.id, words.locale, words).flatMap((binding): ReadonlyArray<StepFactRowView> => {
        if (binding.kind === "empty") return []
        const value = binding.kind === "ref" ? `${words.fromLabel}: ${binding.source}` : `${words.fixedLabel}: ${binding.text}`
        return [{ id: binding.name, label: labelOf(binding.label, binding.name, words), value, helper: binding.typeLabel }]
    })
    const named = new Set(bindings.map((row) => row.id))
    const settings = (node.paramFields ?? []).flatMap((field): ReadonlyArray<StepFactRowView> => {
        const text = field.hidden === true || named.has(field.name) ? "" : settingTextOf(field, words)
        return text === "" ? [] : [{ id: `setting.${field.name}`, label: field.label, value: `${words.fixedLabel}: ${text}`, helper: field.help }]
    })
    return [...bindings, ...settings]
}

/** What it returns: each output member of the step with its words and its kind. */
const outputsOf = (spec: GraphSpec, node: GraphNodeView, words: ExplainWords): ReadonlyArray<StepFactSectionView> =>
    section(
        "outputs",
        words.titles.outputs,
        outputRowsOf(spec, node.id, words.locale).map((output) => ({ id: output.name, label: labelOf(output.label, output.name, words), value: output.typeLabel, helper: "" })),
    )

/** The tools it calls: the tools the step may call, by their labels, a write marked; a tool with no label is not named. */
const toolsOf = (node: GraphNodeView, words: ExplainWords): ReadonlyArray<StepFactSectionView> => {
    const step = node.step
    const declared =
        step === undefined
            ? []
            : (installed.templateNodes.find((one) => one.id === step)?.tools ?? installed.nodes.find((one) => one.id === step)?.tools ?? [])
    return section(
        "tools",
        words.titles.tools,
        [...new Set<string>(declared)].flatMap((tool): ReadonlyArray<StepFactRowView> => {
            const label = toolLabelOf(tool)
            return label === null
                ? []
                : [{ id: tool, label: label.title[words.locale], value: label.kind === "acts" ? words.toolActs : words.toolReads, helper: label.summary[words.locale] }]
        }),
    )
}

/** The word of an exit the graph gives no words to: back for an edge that returns, next otherwise. */
const fallbackExitWord = (isBack: boolean, words: ExplainWords): string => (isBack ? words.exitBack : words.exitNext)

/** Where it goes next: each exit of the step, its words and the step it leads to. */
const exitsOf = (input: ExplainInput, node: GraphNodeView, words: ExplainWords): ReadonlyArray<StepFactSectionView> => {
    const titles = new Map(input.map.nodes.map((one) => [one.id, one.label]))
    return section(
        "exits",
        words.titles.exits,
        input.graph.edges
            .filter((edge) => edge.from === node.id)
            .flatMap((edge): ReadonlyArray<StepFactRowView> => {
                const target = titles.get(edge.to)
                if (target === undefined) return []
                const label = edge.label !== undefined && edge.label !== "" ? edge.label : fallbackExitWord(edge.back === true, words)
                return [{ id: edge.id, label, value: target, helper: "" }]
            }),
    )
}

/** The workflow it calls: the workflow a hand-off calls and what it passes (each input, where it comes from). */
const callOf = (spec: GraphSpec, node: GraphNodeView, words: ExplainWords): ReadonlyArray<StepFactSectionView> => {
    const call = callRowOf(spec, node.id, words.locale)
    if (call === null) return []
    const passed = bindingRowsOf(spec, node.id, words.locale, words).flatMap((binding): ReadonlyArray<StepFactRowView> =>
        binding.kind === "empty"
            ? []
            : [
                  {
                      id: binding.name,
                      label: labelOf(binding.label, binding.name, words),
                      value: binding.kind === "ref" ? `${words.fromLabel}: ${binding.source}` : `${words.fixedLabel}: ${binding.text}`,
                      helper: binding.typeLabel,
                  },
              ],
    )
    return section("call", words.titles.call, [{ id: "target", label: words.callTarget, value: call.targetLabel, helper: call.versionLabel }, ...passed])
}

/** Every section of the explanation of the open step, in the drawer's order; empty for a graph still unread or a step not in it. */
export const explainSectionsOf = (input: ExplainInput, words: ExplainWords): ReadonlyArray<StepFactSectionView> => {
    const node = input.graph.nodes.find((entry) => entry.id === input.nodeKey)
    const spec = input.spec
    if (node === undefined || spec === null) return []
    const isCall = callRowOf(spec, node.id, words.locale) !== null
    return [
        ...whatOf(node, words),
        ...whenOf(spec, node, words),
        ...(isCall ? [] : section("inputs", words.titles.inputs, inputRowsOf(spec, node, words))),
        ...outputsOf(spec, node, words),
        ...toolsOf(node, words),
        ...exitsOf(input, node, words),
        ...callOf(spec, node, words),
    ]
}

/** What the step drawer needs besides the sections: the words of its frame and whether the page can set anything. */
export interface DrawerFrameWords {
    readonly closeLabel: string
    readonly readOnlyNote: string
}

/** The drawer of the open step without its two settings (how it runs, which accounts): its title, line and the read only explanation. */
export const stepDrawerOf = (
    input: ExplainInput,
    words: ExplainWords,
    frame: DrawerFrameWords,
    isReadOnly: boolean,
): Omit<StepDrawerView, "runMode"> => {
    const node = input.graph.nodes.find((entry) => entry.id === input.nodeKey)
    const card = input.map.nodes.find((entry) => entry.id === input.nodeKey)
    return {
        isOpen: node !== undefined,
        title: card?.label ?? node?.title ?? "",
        description: node?.subtitle ?? node?.description ?? "",
        sections: explainSectionsOf(input, words),
        closeLabel: frame.closeLabel,
        isReadOnly,
        readOnlyNote: frame.readOnlyNote,
    }
}
