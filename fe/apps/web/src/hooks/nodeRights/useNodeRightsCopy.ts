"use client"

import { useTranslations } from "next-intl"

/** The screen words of the rights screens (namespace `nodeRights`), grouped by the screen that draws them. */
export interface NodeRightsCopy {
    readonly common: { readonly attach: string; readonly detach: string; readonly more: string; readonly notAttached: string; readonly modeLabel: string }
    /** A: agent › rights. */
    readonly agent: {
        readonly accountsTitle: string
        readonly accountsHint: string
        readonly stepsTitle: string
        readonly stepsHint: string
        readonly stepsEmpty: string
        readonly columnOperation: string
        readonly columnMode: string
        readonly columnStep: string
        readonly moreOperations: (count: number) => string
    }
    /** D: provider › rights. */
    readonly provider: {
        readonly filterAll: string
        readonly filterHeld: string
        readonly filterUnheld: string
        readonly filterWrites: string
        readonly agentsHint: string
        readonly screensHint: string
        readonly moreRights: (count: number) => string
    }
}

/** The screen words of the rights screens, resolved once; each screen reads its own group. */
export const useNodeRightsCopy = (): NodeRightsCopy => {
    const t = useTranslations("nodeRights")
    return {
        common: { attach: t("attach"), detach: t("detach"), more: t("more"), notAttached: t("notAttached"), modeLabel: t("modeLabel") },
        agent: {
            accountsTitle: t("accountsTitle"),
            accountsHint: t("accountsHint"),
            stepsTitle: t("stepsTitle"),
            stepsHint: t("stepsHint"),
            stepsEmpty: t("stepsEmpty"),
            columnOperation: t("columnOperation"),
            columnMode: t("columnMode"),
            columnStep: t("columnStep"),
            moreOperations: (count) => t("moreOperations", { count }),
        },
        provider: {
            filterAll: t("filterAll"),
            filterHeld: t("filterHeld"),
            filterUnheld: t("filterUnheld"),
            filterWrites: t("filterWrites"),
            agentsHint: t("agentsGroupHint"),
            screensHint: t("screensGroupHint"),
            moreRights: (count) => t("moreRights", { count }),
        },
    }
}
