"use client"

import { useCallback } from "react"
import { useModuleCatalog } from "@/hooks/moduleCatalog"
import { navigation } from "@/modules/i18n"
import { CREATE_AGENT_PARAM, CREATE_ANY_ROLE } from "./agentCreate.shared"

/**
 * Opens the create dialog of the agents page through the address: for one role ("+ Add Sales"), or with the role still to choose
 * ("Create agent"). A text that names no role opens it with the role to choose.
 */
export const useOpenAgentCreate = (): ((role?: string) => void) => {
    const router = navigation.useRouter()
    const pathname = navigation.usePathname()
    const { modules } = useModuleCatalog()
    return useCallback(
        (role?: string) => {
            const value = role !== undefined && modules[role] !== undefined ? role : CREATE_ANY_ROLE
            router.replace(`${pathname}?${CREATE_AGENT_PARAM}=${value}`)
        },
        [router, pathname, modules],
    )
}
