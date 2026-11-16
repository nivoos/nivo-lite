import { CALL_WORKFLOW_STEP, type GraphSpec, type GraphSpecNode } from "@nivo-lite/agent-sdk/graph"
import {
    AGENT_LABELS,
    bindableFieldsOf,
    bindingViewOf,
    callViewOf,
    CONTRACT_TYPE_LABELS,
    installed,
    outputFieldsOf,
    paramLabelOf,
    type PickType,
} from "@/modules/plugin-registry"
import { latestTemplateVersion } from "@nivo-lite/agent-sdk/template"
import type { StepBindingView, StepCallView } from "@/modules/types"
import { type RefWords, wordedChipOf, wordedSourceOf } from "./workflowRefLabels"

/*
 * The contract parts of the step drawer, in words, READ ONLY (a workflow's graph is its template's, nothing here is edited): the data
 * params of a step with where each comes from, what the step answers, and the target of a hand-off. The words come from blocks-core;
 * this only lays them out for the drawer.
 */

/** The two languages of the drawer. */
type DrawerLocale = "vi" | "en"

const typeLabelOf = (type: PickType, locale: DrawerLocale): string =>
    type === "unknown" || type === "null" ? "" : CONTRACT_TYPE_LABELS[type][locale]

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** The contract of the workflow a hand-off calls, from the template of that module and key; null when NIVO ships none. */
const targetContractOf = (agent: string, workflow: string): GraphSpec["contract"] | null => {
    const template = installed.templates.find((one) => one.id === `${agent}.${workflow}`)
    return template === undefined ? null : (latestTemplateVersion(template).graph.contract ?? null)
}

/** One data param a step binds: its name, label and type. */
interface BindingField {
    readonly name: string
    readonly label: string
    readonly type: PickType
}

/** The text of a bound param: a ref in words, a fixed null as a dash, any other value as it reads. */
const bindingTextOf = (
    spec: GraphSpec,
    node: GraphSpecNode,
    view: ReturnType<typeof bindingViewOf> | null,
    bound: unknown,
    locale: DrawerLocale,
    words: RefWords,
): string => {
    if (view === null) return ""
    if (view.kind === "ref" && view.ref !== null) return wordedChipOf(spec, node.key, view.ref, locale, words)
    if (view.kind === "fixed" && bound === null) return "—"
    return view.text
}

/** One param as a row: its binding (a ref with where it comes from, a fixed value, or empty). */
const bindingRowOf = (
    spec: GraphSpec,
    node: GraphSpecNode,
    field: BindingField,
    bound: unknown,
    locale: DrawerLocale,
    words: RefWords,
): StepBindingView => {
    const view = bound === undefined ? null : bindingViewOf(field.name, bound, locale)
    return {
        name: field.name,
        label: field.label,
        typeLabel: typeLabelOf(field.type, locale),
        kind: view === null ? "empty" : view.kind,
        text: bindingTextOf(spec, node, view, bound, locale, words),
        source: view?.ref == null ? "" : wordedSourceOf(spec, node.key, view.ref, locale, words),
    }
}

/**
 * The data params of a step with where each comes from. A hand-off's are the inputs of the workflow it calls (`inputs.<name>`), an
 * outcome's the outputs its outcome declares (`outputs.<name>`), any other step's the members of its input schema; the trigger has none.
 */
export const bindingRowsOf = (
    spec: GraphSpec,
    nodeKey: string,
    locale: DrawerLocale,
    words: RefWords,
): ReadonlyArray<StepBindingView> => {
    const node = spec.nodes.find((entry) => entry.key === nodeKey)
    if (node === undefined) return []
    const params: Readonly<Record<string, unknown>> = node.params ?? {}
    const nestedOf = (member: string): Readonly<Record<string, unknown>> => {
        const inner = params[member]
        return isRecord(inner) ? inner : {}
    }
    const row = (field: BindingField, bound: unknown) => bindingRowOf(spec, node, field, bound, locale, words)
    if (node.step === CALL_WORKFLOW_STEP) {
        const agent = typeof params.agent === "string" ? params.agent : ""
        const workflow = typeof params.workflow === "string" ? params.workflow : ""
        const inputs = nestedOf("inputs")
        const declared = targetContractOf(agent, workflow)?.inputs ?? []
        const names = [...new Set([...declared.map((input) => input.name), ...Object.keys(inputs)])]
        return names.map((name) => {
            const input = declared.find((one) => one.name === name)
            return row({ name: `inputs.${name}`, label: paramLabelOf(name, locale), type: input?.type ?? "unknown" }, inputs[name])
        })
    }
    if (node.step === "core.outcome") {
        const outputs = nestedOf("outputs")
        const declared = spec.outcomes?.find((outcome) => outcome.key === params.outcome)?.outputs ?? []
        return declared.map((output) =>
            row({ name: `outputs.${output.name}`, label: paramLabelOf(output.name, locale), type: output.type }, outputs[output.name]),
        )
    }
    return bindableFieldsOf(node.step, locale)
        .filter((field) => field.name !== "locale")
        // A param written as null is bound (to nothing, on purpose); only one the graph does not write is unbound.
        .map((field) => row(field, Object.hasOwn(params, field.name) ? params[field.name] : node.input?.[field.name]))
}

/** What a step answers, for the "what it returns" group: each output member with its words and its kind. */
export const outputRowsOf = (
    spec: GraphSpec,
    nodeKey: string,
    locale: DrawerLocale,
): ReadonlyArray<{ readonly name: string; readonly label: string; readonly typeLabel: string }> => {
    const node = spec.nodes.find((entry) => entry.key === nodeKey)
    if (node === undefined) return []
    if (node.step === "core.outcome") {
        const declared = spec.outcomes?.find((outcome) => outcome.key === node.params?.outcome)?.outputs ?? []
        return declared.map((output) => ({
            name: `out.${output.name}`,
            label: paramLabelOf(output.name, locale),
            typeLabel: typeLabelOf(output.type, locale),
        }))
    }
    return outputFieldsOf(node.step, locale).map((field) => ({
        name: field.name,
        label: field.label,
        typeLabel: typeLabelOf(field.type, locale),
    }))
}

/** The target of a hand-off: the agent and workflow it calls, in words, and the version. Null for any other step. */
export const callRowOf = (spec: GraphSpec, nodeKey: string, locale: DrawerLocale): StepCallView | null => {
    const node = spec.nodes.find((entry) => entry.key === nodeKey)
    const call = node === undefined ? null : callViewOf(node, locale)
    if (node === undefined || call === null) return null
    const template = installed.templates.find((one) => one.id === `${call.agent}.${call.workflow}`)
    const agent = AGENT_LABELS[call.agent]?.[locale] ?? call.agentLabel
    return {
        targetLabel: template === undefined ? `${agent} · ${call.workflowLabel}` : `${agent} · ${template.name[locale]}`,
        versionLabel: call.versionLabel,
    }
}
