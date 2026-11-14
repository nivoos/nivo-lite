import type {
    AgentGraphData,
    AgentGraphHeadView,
    AgentGraphPanelView,
    AgentGraphPhoneView,
    AgentGraphSideTab,
} from "@/modules/types"
import { isSetupPending } from "@/modules/installations"
import { cardLineWithChannels } from "./agent-graph-channels"
import { flowEdgesOf, flowNodesOf, layerHeadersOf } from "./agent-graph-flow"
import { detailViewOf } from "./agent-graph-view-detail"
import { problemsViewOf } from "./agent-graph-view-problems"
import { branchesViewOf, runViewOf, versionsViewOf } from "./agent-graph-view-lists"
import { groupWordOf, legendOf, kindWordOf, waitWordOf, type AgentGraphContext } from "./agent-graph-words"

/** What the person is doing on the panes: the choices that are not data. */
export interface AgentGraphUi {
    readonly selectedKey: string
    readonly sideTab: AgentGraphSideTab
    readonly phoneView: AgentGraphPhoneView
    readonly isDrawerOpen: boolean
    /** The run being traced on the graph; empty when none is. */
    readonly runId: string
}

/**
 * The first words of the status line. An agent that is not set up never claims a running version, whatever version the graph holds:
 * it says the one state of the agent. Otherwise the running version.
 */
const leadOf = (data: AgentGraphData, ctx: AgentGraphContext): string => {
    const { t } = ctx
    if (isSetupPending(ctx.lifecycle) || (ctx.lifecycle !== null && data.activeVersion === 0)) return ctx.lifecycleLabel
    return t("statusVersion", { version: data.activeVersion })
}

/** Where the graph stands, in one line: the state or the running version, then what is left to settle. */
const statusOf = (data: AgentGraphData, ctx: AgentGraphContext): string => {
    const { t } = ctx
    const lead = leadOf(data, ctx)
    if (data.problems.length > 0) return `${lead} · ${t("statusProblems", { count: data.problems.length })}`
    if (data.gaps.length > 0) return `${lead} · ${t("statusGaps", { count: data.gaps.length })}`
    if (!ctx.setup.isReady) return `${lead} · ${t("statusSetupMissing", { count: ctx.setup.missing })}`
    return isSetupPending(ctx.lifecycle) ? lead : `${lead} · ${t("statusClear")}`
}

const headOf = (data: AgentGraphData, ctx: AgentGraphContext): AgentGraphHeadView => ({
    title: ctx.t("title"),
    status: statusOf(data, ctx),
    badges: [],
})

/**
 * Every word the graph panes draw, from the graph and what the person is doing: the head, the cards painted by selection or by a
 * traced run, the detail of the selected node, the problems, the history and the phone list.
 */
export const panelViewOf = (data: AgentGraphData, ui: AgentGraphUi, ctx: AgentGraphContext): AgentGraphPanelView => {
    const { t } = ctx
    const run = data.runs.find((entry) => entry.id === ui.runId) ?? null
    const inspector = run === null ? "detail" : "run"
    return {
        head: headOf(data, ctx),
        canvas: {
            label: t("mapLabel"),
            emptyLabel: t("mapEmpty"),
            nodes: flowNodesOf(
                data.nodes,
                { selectedKey: ui.selectedKey, path: run?.path ?? [] },
                { wait: (wait) => waitWordOf(t, wait), current: t("nodeCurrent") },
            ).map((flow) => {
                const node = data.nodes.find((entry) => entry.key === flow.id)
                return node === undefined
                    ? flow
                    : {
                          ...flow,
                          description: cardLineWithChannels(node, {
                              connected: ctx.channels,
                              none: t("channelNone"),
                          }),
                      }
            }),
            edges: flowEdgesOf(data.nodes, {
                approved: t("edgeApproved"),
                taken: (label) => t("edgeTaken", { label }),
                isTaken: (source, target) => {
                    const at = run?.path.indexOf(source) ?? -1
                    return at >= 0 && run?.path[at + 1] === target
                },
            }),
            headers: layerHeadersOf(
                data.nodes,
                (kind) => kindWordOf(t, kind),
                (group) => groupWordOf(t, group),
            ),
            legend: legendOf(data.nodes, t, run !== null),
            selectedId: ui.selectedKey,
        },
        sideTab: ui.sideTab,
        phoneView: ui.phoneView,
        inspector,
        detail: detailViewOf(data, ui.selectedKey, ctx),
        problems: problemsViewOf(data, ctx),
        run: run === null ? null : runViewOf(run, ctx),
        versions: versionsViewOf(data, ctx),
        branches: branchesViewOf(data, ctx),
        drawerTitle: t("detailTitle"),
        isDrawerOpen: ui.isDrawerOpen,
    }
}
