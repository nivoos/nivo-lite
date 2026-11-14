"use client"

import { useCallback, useMemo } from "react"
import { useConnectionsRole } from "@/hooks/connections"
import { stepRunModeViewOf, type StepSettingsWords } from "@/modules/workflowSteps"
import type { NodeRightMode, StepRunModeView, WorkflowNodeSettings } from "@/modules/types"
import type { StepSettingsWrite } from "./useStepSettingsWrite"

/** What the "how it runs" block of the open step is drawn from and where a change goes. */
interface StepRunModeInput {
    /** What the back end says of the open step; undefined when it names none. */
    readonly settings: WorkflowNodeSettings | undefined
    readonly words: StepSettingsWords
    readonly write: StepSettingsWrite
    /** True for the drawer of a run or a page with no workflow: the block is read only (a run's drawer takes none). */
    readonly isFrozen: boolean
    readonly isRun: boolean
}

/** The block and what choosing does. */
export interface StepRunMode {
    /** Null for a step that takes no mode (the trigger, a control step) and a run's drawer. */
    readonly view: StepRunModeView | null
    readonly choose: (mode: NodeRightMode) => void
}

/**
 * How the open node runs (`auto | ask`, rights.md): drawn from `agentWorkflow.nodeSettings` only for a step that takes a mode, and the
 * owner's change is ONE `setAgentNodeSettings` call. Anybody who is not the owner reads the mode as words.
 */
export const useStepRunMode = (input: StepRunModeInput): StepRunMode => {
    const isOwner = useConnectionsRole().role === "owner"
    const { settings, words, write, isFrozen, isRun } = input
    const current = settings?.mode
    const choose = useCallback(
        (next: NodeRightMode) => {
            if (!isOwner || isFrozen || next === current) return
            write.write({ mode: next })
        },
        [isOwner, isFrozen, current, write],
    )
    const view = useMemo(
        () => (isRun ? null : stepRunModeViewOf(settings, words, { isOwner, isFrozen, isPending: write.isPending })),
        [isRun, settings, words, isOwner, isFrozen, write.isPending],
    )
    return { view, choose }
}
