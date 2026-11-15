"use client"

import { useLocale, useTranslations } from "next-intl"
import { useMemo } from "react"
import { useInstallations, useInstanceRail } from "@/hooks/installations"
import { slotOfSwr } from "@/hooks/slot"
import { useWorkspaceId } from "@/hooks/workspaces"
import { workflowGraphViewOf, type WorkflowGraphView } from "@/modules/agentWorkflowGraph"
import { agentHref } from "@/modules/installations"
import { workspaceHref } from "@/modules/routes"
import type { DataSlot } from "@/modules/types"
import { useQueryAgentWorkflowGraphSwr } from "@/hooks/swr"
import { paramLabelOf } from "@/modules/plugin-registry"

export type { WorkflowGraphView } from "@/modules/agentWorkflowGraph"

/** The Graph tab of an agent as the page draws it. */
interface AgentWorkflowGraphRead {
    readonly slot: DataSlot<WorkflowGraphView>
    /** The name of the agent, empty until read. */
    readonly agentLabel: string
    /** The page of the list of workflows. */
    readonly listHref: string
    readonly retry: () => void
}

/** The workflows of one agent as nodes and edges, every word resolved, every block with the page it opens. */
export const useAgentWorkflowGraphView = (module: string, installationId: string): AgentWorkflowGraphRead => {
    const t = useTranslations("agentGraphTab")
    const locale = useLocale() === "en" ? "en" : "vi"
    const workspaceId = useWorkspaceId()
    const installed = useInstallations()
    const rail = useInstanceRail(installationId)
    const read = useQueryAgentWorkflowGraphSwr(installationId)
    const base = `${agentHref(module, installationId)}/workflows`
    const listHref = workspaceHref(workspaceId, base)
    const { data } = read
    const view = useMemo(
        () =>
            data === undefined
                ? undefined
                : workflowGraphViewOf(
                      data,
                      { noInput: t("noInput"), openEntry: t("openEntry"), paramLabel: (name) => paramLabelOf(name, locale) },
                      {
                          workflowHref: (key) => `${listHref}/${key}`,
                          agentGraphHref: (other) => {
                              const found = installed.installations?.find((one) => one.moduleKey === other)
                              return found === undefined
                                  ? null
                                  : workspaceHref(workspaceId, agentHref(other, found.id, "graph"))
                          },
                      },
                  ),
        [data, t, locale, listHref, installed.installations, workspaceId],
    )
    return {
        slot: slotOfSwr({ data: view, error: read.error, isLoading: read.isLoading }),
        agentLabel: rail.items.find((item) => item.isCurrent)?.name ?? "",
        listHref,
        retry: () => void read.mutate(),
    }
}
