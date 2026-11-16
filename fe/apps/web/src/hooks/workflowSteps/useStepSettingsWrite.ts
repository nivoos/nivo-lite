"use client"

import { useTranslations } from "next-intl"
import { useCallback, useState } from "react"
import { useMutateSetAgentNodeSettingsSwr } from "@/hooks/swr"
import { toast } from "@/modules/toast"
import type { NodeRightMode } from "@/modules/types"
import { reportStepWriteFailure } from "./workflowSteps.shared"

/** The workflow a setting writes to: its id and the newest version number the page read. */
export interface StepSettingsWorkflow {
    readonly id: string
    readonly latestNumber: number
}

/** What one write changes: the mode, or the accounts (connection ids in the order they are tried; empty: the agent's default). */
export interface StepSettingsPatch {
    readonly mode?: NodeRightMode
    readonly accountIds?: ReadonlyArray<string>
}

/** The write of one step's settings and whether it is on its way. */
export interface StepSettingsWrite {
    readonly write: (patch: StepSettingsPatch) => void
    readonly isPending: boolean
}

/**
 * The one door a shop sets a node through (`setAgentNodeSettings`, owner only): ONE call that writes the workflow's next version
 * (`expectedLatest` the version read; runs in flight keep theirs) and reads the workflow again. A refusal is shown in the words the
 * back end catalogue gives its typed code; a newer version reloads the workflow and says so in plain words.
 */
export const useStepSettingsWrite = (
    installationId: string,
    workflow: StepSettingsWorkflow | null,
    nodeKey: string,
    reload: () => Promise<unknown>,
): StepSettingsWrite => {
    const t = useTranslations("workflowSteps")
    const door = useMutateSetAgentNodeSettingsSwr()
    const [isPending, setIsPending] = useState(false)
    const write = useCallback(
        (patch: StepSettingsPatch) => {
            if (workflow === null || nodeKey === "" || isPending) return
            setIsPending(true)
            const road = async (): Promise<void> => {
                await door.trigger({
                    installationId,
                    workflowId: workflow.id,
                    nodeKey,
                    expectedLatest: workflow.latestNumber,
                    ...(patch.mode === undefined ? {} : { mode: patch.mode }),
                    ...(patch.accountIds === undefined ? {} : { accountIds: [...patch.accountIds] }),
                })
                toast.success(t("settingsSavedTitle"), { description: t("settingsSaved") })
                await reload()
            }
            void road()
                .catch((error: unknown) =>
                    reportStepWriteFailure(
                        error,
                        { failed: t("settingsFailed"), conflict: t("settingsConflict") },
                        reload,
                    ),
                )
                .finally(() => setIsPending(false))
        },
        [workflow, nodeKey, isPending, door, installationId, reload, t],
    )
    return { write, isPending }
}
