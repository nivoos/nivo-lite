"use client"

import { useTranslations } from "next-intl"
import { useMemo } from "react"
import { useNodeRightsWords } from "@/hooks/nodeRights"
import type { StepSettingsWords } from "@/modules/workflowSteps"

/** The words of the two settings of a step (how it runs, which accounts), every one from the catalogue; a provider is named, never shown as its key. */
export const useStepSettingsWords = (): StepSettingsWords => {
    const t = useTranslations("workflowSteps")
    const { providerNameOf } = useNodeRightsWords()
    return useMemo(
        () => ({
            runModeTitle: t("runModeTitle"),
            runModeAuto: t("runModeAuto"),
            runModeAutoNote: t("runModeAutoNote"),
            runModeAsk: t("runModeAsk"),
            runModeAskNote: t("runModeAskNote"),
            runModeOwnerOnly: t("runModeOwnerOnly"),
            runModeKeep: t("runModeKeep"),
            accountsTitle: t("accountsTitle"),
            accountsHint: t("accountsHint"),
            accountsNoneAttached: t("accountsNoneAttached"),
            accountsDefaultApplies: t("accountsDefaultApplies"),
            accountsNotWorking: t("accountsNotWorking"),
            orderLine: (position: number) => t("accountsOrder", { position }),
            providerName: providerNameOf,
        }),
        [t, providerNameOf],
    )
}
