"use client"

import { useLocale, useTranslations } from "next-intl"
import { useMemo, useRef, useState } from "react"
import { slotOfSwr } from "@/hooks/slot"
import { useQueryAgentRunSwr, useQueryAgentRunWorkflowsSwr, useQueryAgentRunsSwr } from "@/hooks/swr"
import { runDetailViewOf, runGraphOf } from "@/modules/agentRuns"
import { stepsLocaleOf } from "@/modules/workflowSteps"
import type { DataSlot, RunDetailView } from "@/modules/types"
import { useRunContext } from "./useRunContext"
import { runPollMsOf, runSignatureOf, unchangedAfter, type PollMemory, type PolledRun } from "./runPoll"
import { useRunDecision } from "./useRunDecision"
import { useRunGraphSource } from "./useRunGraphSource"

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
    // A run is read again fast (3 s) only while a step executes; parked on a wait it is read every 30 s, slower while nothing changes,
    // and never while the tab is hidden (a run parked for hours must not keep a page busy).
    const memory = useRef<PollMemory>({ signature: "", unchanged: 0 })
    const read = useQueryAgentRunSwr(
        { installationId, runId },
        {
            refreshWhenHidden: false,
            refreshInterval: (latest: PolledRun | null | undefined) =>
                runPollMsOf(latest, unchangedAfter(memory.current, runSignatureOf(latest)), Date.now()),
        },
    )
    // The page is made again only when the signature of the answer changes, never for a duration that only grew.
    const stable = useRef<{ signature: string; data: typeof read.data }>({ signature: "", data: undefined })
    const signature = runSignatureOf(read.data)
    if (read.data === undefined || stable.current.signature !== signature || stable.current.data === undefined) {
        stable.current = { signature, data: read.data }
    }
    const data = stable.current.data
    const runs = useQueryAgentRunsSwr({ installationId })
    const pins = useQueryAgentRunWorkflowsSwr({ installationId, runIds: [runId] })
    const pin = pins.data?.[0]
    const source = useRunGraphSource(installationId, pin, pins.data !== undefined)
    const nodes = useMemo(
        () => runGraphOf(source, locale, (key) => (t.has(`nodeName_${key}`) ? t(`nodeName_${key}`) : undefined)),
        [source, locale, t],
    )
    const view = useMemo(() => {
        if (data === undefined || data === null) return undefined
        const detail =
            pin === undefined
                ? data
                : {
                      ...data,
                      row: { ...data.row, versionNumber: pin.version, workflowName: pin.workflowName },
                  }
        return runDetailViewOf(detail, nodes, selection, runs.data, baseContext, locale)
    }, [data, pin, nodes, selection, runs.data, baseContext, locale])
    const { mutate } = read
    return {
        slot: slotOfSwr<RunDetailView>({ data: view, error: read.error, isLoading: read.isLoading }),
        select: setSelection,
        ...decision,
        isMissing: read.data === null,
        reload: () => void mutate(),
    }
}
