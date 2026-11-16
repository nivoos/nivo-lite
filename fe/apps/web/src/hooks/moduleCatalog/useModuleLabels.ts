"use client"

import { useLocale } from "next-intl"
import { useModuleCatalog } from "./useModuleCatalog"
import { pickCopy, type ModuleChoices, type ModuleLabelOf } from "@/modules/catalog"

/** The names of the modules the catalogue serves the open workspace, as a lookup and as a choice list, in the reader language. */
export const useModuleLabels = (): { readonly choices: ModuleChoices; readonly labelOf: ModuleLabelOf } => {
    const locale = useLocale() === "en" ? "en" : "vi"
    const { list, modules } = useModuleCatalog()
    return {
        choices: list.map((entry) => ({ id: entry.key, label: pickCopy(entry.name, locale) })),
        labelOf: (key) => {
            const copy = key === null || key === undefined ? undefined : modules[key]
            return copy === undefined ? null : pickCopy(copy.name, locale)
        },
    }
}
