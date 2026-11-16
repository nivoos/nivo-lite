"use client"

import { useLocale } from "next-intl"
import { useMemo, useRef, useState } from "react"
import { slotOfSwr } from "@/hooks/slot"
import { useQueryAgentRunWorkflowsSwr, useQueryAgentRunsSwr, useQueryAgentWorkflowsSwr } from "@/hooks/swr"
import { NO_FILTER, pinnedRunsOf, runsViewOf } from "@/modules/agentRuns"
import type { DataSlot, RunsFilter, RunsView } from "@/modules/types"
import { boardPollMsOf, unchangedAfter, type PollMemory, type PolledBoard } from "./runPoll"
import { useRunContext } from "./useRunContext"

/** The pin read takes at most this many runs. */
const PIN_LIMIT = 100

/** What the list of runs needs: the read, the filters over it and the moves that change them. */
export interface AgentRunsData {
    readonly slot: DataSlot<RunsView>
    readonly filter: RunsFilter
    readonly setFilter: (next: Partial<RunsFilter>) => void
    readonly reload: () => void
}

/** What changed on a board, as text: a run that only grew longer is not a change. */
const boardSignatureOf = (
    latest:
        | {
              readonly runs: ReadonlyArray<{
                  readonly id: string
                  readonly status: string
                  readonly stepNumber: number
                  readonly errorCode?: string | null | undefined
                  readonly parked?: boolean | null | undefined
              }>
          }
        | undefined,
): string =>
    (latest?.runs ?? [])
        .map(
            (run) =>
                `${run.id}:${run.status}:${run.stepNumber}:${run.errorCode ?? ""}:${run.parked === true ? "w" : ""}`,
        )
        .join("|")

/**
 * The runs of one agent instance, in words, with the filters of the page (workflow, status tab, source and text). The board is read every
 * 5 seconds only while a run executes a step or waits for its place; while every run in flight is parked (a wait for a customer, a
 * payment, a person, a timer) it is read every 30 seconds, doubling to 60 after reads that change nothing; a hidden tab reads nothing.
 */
export const useAgentRuns = (module: string, installationId: string): AgentRunsData => {
    const context = useRunContext(module, installationId)
    const [filter, setFilter] = useState<RunsFilter>(NO_FILTER)
    const memory = useRef<PollMemory>({ signature: "", unchanged: 0 })
    const read = useQueryAgentRunsSwr(
        { installationId },
        {
            refreshWhenHidden: false,
            refreshInterval: (latest: (PolledBoard & Parameters<typeof boardSignatureOf>[0]) | undefined) =>
                boardPollMsOf(latest, unchangedAfter(memory.current, boardSignatureOf(latest))),
        },
    )
    const locale = useLocale()
    const workflows = useQueryAgentWorkflowsSwr({ installationId, locale })
    const runIds = (read.data?.runs ?? []).slice(0, PIN_LIMIT).map((row) => row.id)
    const pins = useQueryAgentRunWorkflowsSwr(runIds.length === 0 ? null : { installationId, runIds })
    const isPinning = (runIds.length > 0 && pins.data === undefined && pins.error === undefined) || workflows.isLoading
    const view = useMemo(
        () =>
            read.data === undefined || isPinning
                ? undefined
                : runsViewOf(
                      pinnedRunsOf(
                          read.data,
                          pins.data ?? [],
                          (workflows.data ?? []).map((workflow) => ({ id: workflow.id, name: workflow.name })),
                      ),
                      filter,
                      context,
                  ),
        [read.data, pins.data, workflows.data, isPinning, filter, context],
    )
    return {
        slot: slotOfSwr<RunsView>({ data: view, error: read.error, isLoading: read.isLoading || isPinning }),
        filter,
        setFilter: (next) => setFilter((current) => ({ ...current, ...next })),
        reload: () => void read.mutate(),
    }
}
