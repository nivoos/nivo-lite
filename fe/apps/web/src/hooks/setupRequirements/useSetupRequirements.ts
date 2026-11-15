"use client"

import { useMemo } from "react"
import { useQueryModuleRequirementFactsSwr } from "@/hooks/swr"
import { useWorkspaceId } from "@/hooks/workspaces"
import { useModuleCatalog } from "@/hooks/moduleCatalog"
import { unmetRequirementsOf, type UnmetRequirement } from "./setupRequirements.shared"

/** The requirements of a module the workspace does not meet yet; none while the facts load or when they cannot be read. */
export const useSetupRequirements = (moduleKey: string): ReadonlyArray<UnmetRequirement> => {
    const { data } = useQueryModuleRequirementFactsSwr()
    const workspaceId = useWorkspaceId()
    const requires = useModuleCatalog().modules[moduleKey]?.requires
    return useMemo(
        () => (data === undefined || requires === undefined ? [] : unmetRequirementsOf(requires, data, workspaceId)),
        [data, requires, workspaceId],
    )
}
