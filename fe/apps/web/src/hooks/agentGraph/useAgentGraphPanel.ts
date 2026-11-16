"use client"

import { useTranslations } from "next-intl"
import { useInstallations, useInstanceChannels } from "@/hooks/installations"
import { mapSlot } from "@/hooks/slot"
import {
    AGENT_GRAPH_PLACEHOLDER,
    type AgentGraphSetupState,
    mediumAreasOf,
    mediumRowsOf,
    panelViewOf,
    phoneAreasOf,
    phoneRowsOf,
} from "@/modules/agent-graph"
import type {
    AgentGraphAction,
    AgentGraphPanelView,
    DataSlot,
    AgentGraphSideTab,
    AgentGraphPhoneView,
} from "@/modules/types"
import { agentGraphCommandsOf, performAgentGraphAction } from "./agentGraph.shared"
import { useAgentGraphRead } from "./useAgentGraphRead"
import { useAgentGraphUi } from "./useAgentGraphUi"
import { useAgentGraphWords } from "./useAgentGraphWords"

/** The view `useAgentGraphPanel` returns. */
export interface AgentGraphPanelViewShape {
    props: {
        graph: DataSlot<AgentGraphPanelView>
        graphPlaceholder: AgentGraphPanelView
        sideTab: AgentGraphSideTab
        phoneView: AgentGraphPhoneView
        layout: {
            phoneAreas: readonly string[]
            phoneRows: readonly ("fill" | "auto")[]
            mediumAreas: readonly string[]
            mediumRows: readonly ("fill" | "auto")[]
        }
    }
    on: {
        retryGraph: () => void
        graph: (action: AgentGraphAction) => void
    }
}

/**
 * The graph panes of the Setup tab as one view with its commands: the map and its cards painted by selection or by a traced run,
 * the seven answers of the selected node, the problems and the history, all read only. Words are resolved here.
 */
export const useAgentGraphPanel = (installationId: string, setup: AgentGraphSetupState): AgentGraphPanelViewShape => {
    const t = useTranslations("agentGraph")
    const tAgent = useTranslations("modulesCore")
    const { installations } = useInstallations()
    const graph = useAgentGraphRead(installationId)
    const state = useAgentGraphUi(graph.runId)
    const words = useAgentGraphWords(t)
    const commands = agentGraphCommandsOf(graph.read, state)
    const channelsOf = useInstanceChannels()
    const lifecycle = installations?.find((one) => one.id === installationId)?.lifecycle ?? null
    const ctx = {
        t,
        amount: words.amount,
        setup,
        channels: channelsOf(graph.read?.agentId ?? null),
        lifecycle,
        lifecycleLabel: lifecycle === null ? "" : tAgent(`lifecycle_${lifecycle}`),
    }
    const phoneAreas = phoneAreasOf(state.ui.phoneView, state.ui.sideTab)
    return {
        props: {
            graph: mapSlot(graph.slot, (data): AgentGraphPanelView => panelViewOf(data, state.ui, ctx)),
            graphPlaceholder: panelViewOf(AGENT_GRAPH_PLACEHOLDER, state.ui, ctx),
            sideTab: state.ui.sideTab,
            phoneView: state.ui.phoneView,
            layout: {
                phoneAreas,
                phoneRows: phoneRowsOf(phoneAreas),
                mediumAreas: mediumAreasOf(state.ui.sideTab),
                mediumRows: mediumRowsOf(state.ui.sideTab),
            },
        },
        on: {
            retryGraph: graph.reload,
            graph: (action: AgentGraphAction) => performAgentGraphAction(commands, action),
        },
    }
}
