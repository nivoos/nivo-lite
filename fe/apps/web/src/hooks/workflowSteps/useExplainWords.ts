"use client"

import { useFormatter, useLocale, useTranslations } from "next-intl"
import { useMemo } from "react"
import { stepsLocaleOf, type ExplainWords } from "@/modules/workflowSteps"

/** The words of the drawer's frame that sit beside the explanation. */
type DrawerWords = ExplainWords & {
    readonly closeLabel: string
    readonly readOnlyNote: string
    readonly noWorkflowNote: string
    readonly defaultLabel: string
    readonly sandboxLabel: string
}

/** The words of the explanation and of the drawer's frame, every one read from the catalog here, numbers through the app's formatter. */
export const useExplainWords = (): DrawerWords => {
    const t = useTranslations("workflowSteps")
    const locale = stepsLocaleOf(useLocale())
    const format = useFormatter()
    return useMemo(
        () => ({
            locale,
            required: t("required"),
            unnamed: t("unnamedValue"),
            members: {
                eventId: t("memberEvent"),
                routeId: t("memberRoute"),
                contactId: t("memberContact"),
                accountId: t("memberAccount"),
                startedAt: t("memberTime"),
            },
            titles: {
                what: t("sectionWhat"),
                when: t("sectionWhen"),
                inputs: t("sectionInputs"),
                outputs: t("sectionOutputs"),
                tools: t("sectionTools"),
                exits: t("sectionExits"),
                call: t("sectionCall"),
            },
            fromLabel: t("fromLabel"),
            fixedLabel: t("fixedLabel"),
            waitsFor: t("waitsFor"),
            waitLimit: t("waitLimit"),
            everyEvent: t("everyEvent"),
            supplies: (members: string) => t("supplies", { members }),
            toolActs: t("toolActs"),
            toolReads: t("toolReads"),
            exitNext: t("exitNext"),
            exitBack: t("exitBack"),
            callTarget: t("callTarget"),
            yes: t("yes"),
            no: t("no"),
            number: (value: number, input: string, unit: string | undefined) => {
                if (input === "money")
                    return format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 })
                return unit === undefined
                    ? format.number(value)
                    : format.number(value, { style: "unit", unit, unitDisplay: "long" })
            },
            closeLabel: t("close"),
            readOnlyNote: t("readOnly"),
            noWorkflowNote: t("noWorkflow"),
            defaultLabel: t("accountsDefault"),
            sandboxLabel: t("accountsSandbox"),
        }),
        [t, format, locale],
    )
}

