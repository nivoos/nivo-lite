"use client"

import { useTranslations } from "next-intl"
import { useState } from "react"
import { useMutateEndAgentWorkflowRunsSwr, useMutateSetAgentWorkflowStatusSwr } from "@/hooks/swr"
import { toast, useGraphQLWithToast } from "@/modules/toast"
import type { WorkflowRunView } from "@/modules/types"

/** What a dialog of the run commands asks: stop the workflow, start it again, or end every run in flight. */
export type WorkflowRunAskKind = "stop" | "start" | "end"

/** The workflow a dialog is about, and the command it asks for. */
export interface WorkflowRunAsk {
    readonly kind: WorkflowRunAskKind
    readonly workflow: { readonly id: string; readonly name: string; readonly run: WorkflowRunView }
}

/** What the person chose in the stop dialog. */
export interface WorkflowStopChoice {
    readonly endRuns: boolean
    readonly holdEvents: boolean
}

/** The run commands of the workflows of an agent, shared by the page of one workflow and the table of all. */
export interface WorkflowRunControl {
    /** The open dialog; null while none is. */
    readonly ask: WorkflowRunAsk | null
    readonly open: (ask: WorkflowRunAsk) => void
    readonly close: () => void
    /** Does what the open dialog asks, reads the workflows again and closes it. */
    readonly confirm: (choice: WorkflowStopChoice) => Promise<void>
}

/**
 * Stop a workflow (it takes no new work; optionally its runs in flight end, and the events that arrive are kept or only recorded),
 * start it again (kept events run in order of arrival), or end all its runs in flight (it keeps taking work). Each writes once with
 * its own toast, then reads again; a failure shows the error toast and the dialog closes.
 */
export const useWorkflowRunControl = (installationId: string, refresh: () => Promise<void>): WorkflowRunControl => {
    const t = useTranslations("workflowStop")
    const runGraphQL = useGraphQLWithToast()
    const statusWrite = useMutateSetAgentWorkflowStatusSwr()
    const endWrite = useMutateEndAgentWorkflowRunsSwr()
    const [ask, setAsk] = useState<WorkflowRunAsk | null>(null)
    const confirm = async (choice: WorkflowStopChoice): Promise<void> => {
        if (ask === null) return
        const workflowId = ask.workflow.id
        await runGraphQL(
            async () => {
                if (ask.kind === "stop") {
                    await statusWrite.trigger({
                        installationId,
                        workflowId,
                        status: "paused",
                        holdEvents: choice.holdEvents,
                        endRuns: choice.endRuns,
                    })
                    toast.success(t("stopped"))
                } else if (ask.kind === "start") {
                    await statusWrite.trigger({ installationId, workflowId, status: "active" })
                    toast.success(t("started"))
                } else {
                    const answer = await endWrite.trigger({ workflowId })
                    toast.success(t("ended", { count: answer.ended }))
                }
            },
            { showSuccessToast: false },
        )
        await refresh()
        setAsk(null)
    }
    return { ask, open: setAsk, close: () => setAsk(null), confirm }
}
