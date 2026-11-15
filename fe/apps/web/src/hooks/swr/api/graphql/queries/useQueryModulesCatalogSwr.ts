"use client"

import useSWR, { type SWRResponse } from "swr"
import { useWorkspaceKey } from "@/hooks/workspaceKey"
import { queryModulesCatalog } from "@/modules/api/graphql/queries/query-modules-catalog"
import type { ModulesCatalogQuery } from "@/modules/api"

/** The authenticated catalogue cache; it contains both product languages and is read per workspace. */
export const QUERY_MODULES_CATALOG_SWR_KEY = "QUERY_MODULES_CATALOG_SWR"

/**
 * Reads the catalogue of the open workspace: what the back end serves THAT workspace (public plugins plus the private plugins of its
 * enterprise). The workspace is part of the cache identity, so a switch of workspace reads afresh.
 */
export const useQueryModulesCatalogSwr = (): SWRResponse<ModulesCatalogQuery["modulesCatalog"], Error> =>
    useSWR(useWorkspaceKey(QUERY_MODULES_CATALOG_SWR_KEY, []), async ([, workspaceId]) => {
        const result = await queryModulesCatalog({ workspaceId })
        if (!result.data) throw new Error("modulesCatalog answered no data")
        return result.data.modulesCatalog
    })
