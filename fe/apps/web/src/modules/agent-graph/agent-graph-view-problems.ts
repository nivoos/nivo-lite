import type { AgentGraphData, AgentGraphProblemsView } from "@/modules/types"
import { problemLinesOf } from "./agent-graph-problems"
import type { AgentGraphContext } from "./agent-graph-words"

/** The problems of the draft as a list in the owner's words, each with the step to open. */
export const problemsViewOf = (data: AgentGraphData, ctx: AgentGraphContext): AgentGraphProblemsView => {
    const { t } = ctx
    const lines = problemLinesOf(data, t)
    const absent = data.gaps
        .filter((gap) => gap.code === "approver_absent")
        .map((gap, index) => ({
            id: `absent-${gap.nodeKey}-${gap.branchKey}-${index}`,
            nodeKey: gap.nodeKey,
            text: t("gap_approver_absent", {
                branch:
                    data.nodes
                        .find((entry) => entry.key === gap.nodeKey)
                        ?.branches.find((entry) => entry.key === gap.branchKey)?.whenFull ?? "",
            }),
            isGrant: false,
        }))
    return {
        title: t("problemsTitle", { count: lines.length + absent.length }),
        items: [
            ...lines.map((line) => ({ id: line.id, nodeKey: line.nodeKey, text: line.text, isGrant: line.isGrant })),
            ...absent,
        ],
        openLabel: t("problemOpen"),
        grantLabel: t("problemGrant"),
        moreLabel: t("problemsMore", { count: Math.max(0, lines.length + absent.length - 1) }),
    }
}
