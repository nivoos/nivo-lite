"use client"

import { useMemo } from "react"
import { slotOfSwr } from "@/hooks/slot"
import { useQueryModulesCatalogSwr } from "@/hooks/swr"
import type { ModuleCopy } from "@/modules/catalog"
import { readError } from "@/hooks/workspaceread"
import type { DataSlot } from "@/modules/types"

/** A module of the catalogue by its key; a key the catalogue did not serve this workspace is absent. */
type ModulesByKey = Readonly<Record<string, ModuleCopy | undefined>>

/** What the catalogue of the open workspace gives a screen. */
export interface ModuleCatalogView {
    readonly read: ReturnType<typeof useQueryModulesCatalogSwr>
    /** The modules in display order; empty while the catalogue loads. */
    readonly list: ReadonlyArray<ModuleCopy>
    readonly modules: ModulesByKey
    readonly categories: ReadonlyArray<{ readonly key: string; readonly label: { readonly vi: string; readonly en: string } }>
    readonly error: unknown
    readonly slot: DataSlot<ReadonlyArray<ModuleCopy>>
    readonly reload: () => undefined
}

/**
 * The catalogue of the open workspace: every module the back end serves it (public plugins and the private plugins of its enterprise),
 * in the back end's display order, by key, with its read state. Nothing is dropped or added here.
 */
export const useModuleCatalog = (): ModuleCatalogView => {
    const read = useQueryModulesCatalogSwr()
    const list = useMemo(
        (): ReadonlyArray<ModuleCopy> | undefined =>
            read.data === undefined ? undefined : [...read.data.modules].sort((a, b) => a.order - b.order),
        [read.data],
    )
    const modules = useMemo(
        (): ModulesByKey => (list === undefined ? {} : Object.fromEntries(list.map((entry) => [entry.key, entry]))),
        [list],
    )
    return {
        read,
        list: list ?? [],
        modules,
        categories: read.data?.categories ?? [],
        error: readError(read),
        slot: slotOfSwr<ReadonlyArray<ModuleCopy>>({ data: list, error: read.error, isLoading: read.isLoading }),
        reload: (): undefined => void read.mutate(),
    }
}
