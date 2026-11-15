"use client"

import { useLocale } from "next-intl"
import { useCallback } from "react"
import { useModuleCatalog } from "@/hooks/moduleCatalog"
import { audienceNamesOf, type CatalogEntry } from "./connection-catalog.shared"

/** The agent types that work through a connector, by name in the reader language, as the catalogue of the open workspace serves them. */
export const useAudienceOf = (): ((entry: CatalogEntry) => ReadonlyArray<string>) => {
    const locale = useLocale() === "en" ? "en" : "vi"
    const { list } = useModuleCatalog()
    return useCallback((entry) => audienceNamesOf(entry, list, locale), [list, locale])
}
