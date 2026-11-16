import type {
    AgentGraphBranchesView,
    AgentGraphData,
    AgentGraphRunData,
    AgentGraphRunView,
    AgentGraphVersionsView,
} from "@/modules/types"
import { branchHitsOf } from "./agent-graph-flow"
import { sourceWordOf, type AgentGraphContext } from "./agent-graph-words"

/** The history: every saved version, newest first (read only: going back to one is no door a shop has). */
export const versionsViewOf = (data: AgentGraphData, ctx: AgentGraphContext): AgentGraphVersionsView => {
    const { t } = ctx
    return {
        title: t("versionsTitle"),
        hint: t("versionsHint"),
        activeChip: data.activeVersion > 0 ? t("versionChip", { version: data.activeVersion }) : "",
        items: data.versions.map((version) => ({
            id: version.id,
            title: t("versionN", { version: version.version }),
            badge: version.isActive ? { text: t("badgeRunning"), tone: "success" } : null,
            note: version.note,
            byLine: version.byLine,
            isActive: version.isActive,
        })),
    }
}

/** Every branch as a sentence for the phone: when, what happens, with what and on whose rule. */
export const branchesViewOf = (data: AgentGraphData, ctx: AgentGraphContext): AgentGraphBranchesView => {
    const { t } = ctx
    const decide = data.nodes.find((node) => node.branches.length > 0)
    return {
        title: decide === undefined ? t("branchesTitle") : decide.title,
        hint: t("branchesHint"),
        emptyLabel: t("branchesEmpty"),
        rows: branchHitsOf(data.nodes).flatMap((hit) => {
            const target = data.nodes.find((node) => node.key === hit.branch.next)
            if (target === undefined) return []
            const source = hit.branch.selfCorrected ? "corrected" : (hit.branch.sources[0]?.kind ?? null)
            return [
                {
                    id: `${hit.parent.key}:${hit.branch.key}`,
                    nodeKey: target.key,
                    when: hit.branch.when,
                    title: target.title,
                    line: target.card.description,
                    source: source === null ? "" : sourceWordOf(t, source),
                    openLabel: t("openDetail"),
                },
            ]
        }),
    }
}

/** A traced run: what happened, step by step, and what the run left out. */
export const runViewOf = (run: AgentGraphRunData, ctx: AgentGraphContext): AgentGraphRunView => ({
    title: run.title,
    outcome: run.outcome,
    summary: run.summary,
    mismatch: run.mismatch,
    stepsLabel: ctx.t("runSteps"),
    steps: run.steps,
    skipped: run.skipped,
    backLabel: ctx.t("runBack"),
})
