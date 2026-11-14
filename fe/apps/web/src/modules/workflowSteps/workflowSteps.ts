import { graphSpecSchema, type GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { type GraphNodeView, type GraphView, graphViewOfSpec, nodeCardsOf } from "@/modules/plugin-registry"
import { stepsFlowOf, stepsLegendOf, stepsStatusLabelsOf } from "@/modules/plugin-registry/client"
import type { StepsMapView } from "@/modules/types"

import { dressedGraphOf, framedFlowOf, legendOf } from "./workflowMap"

/** The two languages the cards are written in. */
export type StepsLocale = "vi" | "en"

/** The language of a locale code: English for `en`, Vietnamese for the rest. */
export const stepsLocaleOf = (locale: string): StepsLocale => (locale === "en" ? "en" : "vi")

/** A graph read from JSON text or a parsed document; null for anything that is not a graph spec. */
export const specOf = (source: unknown): GraphSpec | null => {
    if (source === null || source === undefined) return null
    try {
        const value: unknown = typeof source === "string" ? JSON.parse(source) : source
        const parsed = graphSpecSchema.safeParse(value)
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

/**
 * The graph view of a spec in one language, with the trigger card first: every title, line, port and setting in words. The control
 * steps (condition, wait, loop, hand-back) carry the graph's own words; a wait is dressed with its events and time.
 */
export const graphOfSpec = (spec: GraphSpec | null, locale: StepsLocale): GraphView =>
    spec === null ? { nodes: [], edges: [] } : dressedGraphOf(graphViewOfSpec(spec, { locale, withTrigger: true }), locale)

/** The card map of a graph view: the step cards, the edges, the kind legend and the status words. */
export const stepsMapOf = (graph: GraphView, locale: StepsLocale): StepsMapView => {
    const flow = framedFlowOf(stepsFlowOf(graph, locale), graph, locale)
    return {
        nodes: flow.nodes,
        edges: flow.edges,
        legend: legendOf(stepsLegendOf(locale), flow.nodes, locale),
        statusLabels: stepsStatusLabelsOf(locale),
    }
}

/** A node key or node id in one comparable form: letters and digits only, lower case ("matchCode", "match-code" → "matchcode"). */
const squashed = (text: string): string => text.toLowerCase().replaceAll(/[^a-z0-9]/g, "")

/**
 * The card of a node known only by its key (a run on a graph version that is no longer the one read): the core node whose id ends in
 * the same words ("matchCode" → `payment.match-code`), as a graph node with its title, line, kind and icon; null when none matches.
 */
export const nodeOfKey = (key: string, locale: StepsLocale): GraphNodeView | null => {
    const wanted = squashed(key)
    const card = [...nodeCardsOf(locale).values()].find((one) => squashed(one.id.split(".").pop() ?? one.id) === wanted)
    return card === undefined
        ? null
        : {
              id: key,
              label: card.title,
              kind: card.kind,
              description: card.subtitle,
              step: card.id,
              title: card.title,
              subtitle: card.subtitle,
              icon: card.icon,
              heroicon: card.heroicon,
          }
}

/** A map with nothing on it, for the skeleton. */
export const EMPTY_STEPS_MAP: StepsMapView = {
    nodes: [],
    edges: [],
    legend: [],
    statusLabels: { done: "", running: "", failed: "", waiting: "", skipped: "" },
}
