"use client"

import { useModuleCatalog } from "@/hooks/moduleCatalog"
import { useModuleName } from "@/hooks/installations"

/** The name of the module an agent works for, in the reader language; a module the catalogue answered without says its key. */
export const useProfileModuleName = (module: string | undefined): string => {
    const catalogName = useModuleName(module ?? null)
    const { read } = useModuleCatalog()
    return catalogName === "" && read.data !== undefined ? (module ?? "") : catalogName
}
