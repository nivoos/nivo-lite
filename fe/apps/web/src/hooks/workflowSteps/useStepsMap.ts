"use client"

import type { FlowGraphChip } from "@starci/grammar/common"
import { useMemo } from "react"
import type { GraphView } from "@/modules/plugin-registry"
import type { AgentRightAccountView, StepsMapView } from "@/modules/types"
import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { accountChipsOf, stepsMapOf, type StepAccountsWords, type StepsLocale } from "@/modules/workflowSteps"

/** A record of chips by card id, which a guard of the parsed signature proves. */
type ChipsByCard = Readonly<Record<string, ReadonlyArray<FlowGraphChip>>>

const isChipsByCard = (value: unknown): value is ChipsByCard => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The card map of a graph with each card's accounts as chips. The signature of the chips keeps the map the same object while nothing on
 * the cards changed (the accounts list is a new array on every read).
 */
export const useStepsMap = (
    spec: GraphSpec | null,
    graph: GraphView,
    locale: StepsLocale,
    attached: ReadonlyArray<AgentRightAccountView> | undefined,
    words: StepAccountsWords,
): StepsMapView => {
    const baseMap = useMemo(() => stepsMapOf(graph, locale), [graph, locale])
    const chips: ChipsByCard =
        attached === undefined
            ? {}
            : Object.fromEntries(graph.nodes.map((node) => [node.id, accountChipsOf(spec, node.id, attached, words)]))
    const chipsKey = JSON.stringify(chips)
    return useMemo<StepsMapView>(() => {
        const parsed: unknown = JSON.parse(chipsKey)
        const own: ChipsByCard = isChipsByCard(parsed) ? parsed : {}
        return {
            ...baseMap,
            nodes: baseMap.nodes.map((node) => {
                const added = own[node.id] ?? []
                return added.length === 0 ? node : { ...node, chips: [...(node.chips ?? []), ...added] }
            }),
        }
    }, [baseMap, chipsKey])
}
