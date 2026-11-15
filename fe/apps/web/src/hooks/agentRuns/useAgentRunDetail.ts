"use client"

import { useLocale, useTranslations } from "next-intl"
import { useMemo, useState } from "react"
import { slotOfSwr } from "@/hooks/slot"
import { useQueryAgentRunSwr, useQueryAgentRunWorkflowsSwr, useQueryAgentRunsSwr } from "@/hooks/swr"
import { runDetailViewOf, runGraphOf } from "@/modules/agentRuns"
import { stepsLocaleOf } from "@/modules/workflowSteps"
import type { DataSlot, RunDetailView } from "@/modules/types"
import { useRunContext } from "./useRunContext"
import { useRunDecision } from "./useRunDecision"
import { useRunGraphSource } from "./useRunGraphSource"

/** A run that is being driven is read again every 3 seconds, so its steps and its map move while the page is open. */
const BUSY_MS = 3_000

/** The page of one run: the read, the step the person selected and the decision it waits on. */
export interface AgentRunDetailData {
    readonly slot: DataSlot<RunDetailView>
    readonly select: (nodeKey: string) => void
    /** Answers the decision the run waits on. */
    readonly decide: (verdict: "approve" | "retry" | "reject") => void
    readonly isDeciding: boolean
    /** The agent has no such run. */
    readonly isMissing: boolean
    readonly reload: () => void
}

/** The run of one agent instance with its steps, the map of the graph it ran on painted by them, and the step selected. */
export const useAgentRunDetail = (module: string, installationId: string, runId: string): AgentRunDetailData => {
    const t = useTranslations("agentRuns")
    const locale = stepsLocaleOf(useLocale())
    const baseContext = useRunContext(module, installationId)
    const decision = useRunDecision(installationId, runId)
    const [selection, setSelection] = useState("")
    const read = useQueryAgentRunSwr(
        { installationId, runId },
        {
            refreshInterval: (latest: { readonly row: { readonly status: string } } | null | undefined) =>
                latest?.row.status === "running" || latest?.row.status === "waiting" || latest?.row.status === "paused"
                    ? BUSY_MS
                    : 0,
        },
    )
    const runs = useQueryAgentRunsSwr({ installationId })
    const pins = useQueryAgentRunWorkflowsSwr({ installationId, runIds: [runId] })
    const pin = pins.data?.[0]
    const source = useRunGraphSource(installationId, pin, pins.data !== undefined)
    const nodes = useMemo(
        () => runGraphOf(source, locale, (key) => (t.has(`nodeName_${key}`) ? t(`nodeName_${key}`) : undefined)),
        [source, locale, t],
    )
    const view = useMemo(() => {
        if (read.data === undefined || read.data === null) return undefined
        const detail =
            pin === undefined
                ? read.data
                : {
                      ...read.data,
                      row: { ...read.data.row, versionNumber: pin.version, workflowName: pin.workflowName },
                  }
        return runDetailViewOf(detail, nodes, selection, runs.data, baseContext, locale)
    }, [read.data, pin, nodes, selection, runs.data, baseContext, locale])
    const { mutate } = read
    return {
        slot: slotOfSwr<RunDetailView>({ data: view, error: read.error, isLoading: read.isLoading }),
        select: setSelection,
        ...decision,
        isMissing: read.data === null,
        reload: () => void mutate(),
    }
}
