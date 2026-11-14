"use client"

import { useTranslations } from "next-intl"
import { useMemo } from "react"
import { useAgentNodeRights } from "@/hooks/nodeRights"
import { useQueryModuleInstallationsSwr } from "@/hooks/swr"
import type { StepAccountsWords } from "@/modules/workflowSteps"
import type { AgentRightAccountView } from "@/modules/types"

/** The accounts the agent of this installation is attached to (what the chips on the step cards name), and the words of the chips. */
export interface StepAccounts {
    /** The agent's attached accounts; undefined while the read is in flight or when it failed. */
    readonly attached: ReadonlyArray<AgentRightAccountView> | undefined
    readonly words: StepAccountsWords
}

/** The attached accounts (`agentNodeRights.accounts`) of the agent that runs this installation, with the chip words. */
export const useStepAccounts = (installationId: string): StepAccounts => {
    const t = useTranslations("nodeRights")
    const installations = useQueryModuleInstallationsSwr().data
    const agentId = installations?.find((one) => one.id === installationId)?.agentId ?? null
    const { slot } = useAgentNodeRights(agentId)
    const words = useMemo<StepAccountsWords>(
        () => ({
            chipNoProvider: t("panelNoProvider"),
            chipProvider: (account) => t("chipProvider", { account }),
            chipMessaging: (account) => t("chipMessaging", { account }),
        }),
        [t],
    )
    return { attached: "items" in slot ? slot.items.accounts : undefined, words }
}
