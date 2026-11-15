"use client"

import { useParams } from "next/navigation"
import { useModuleCatalog } from "@/hooks/moduleCatalog"
import { answersCustomersOf, hasReplyLimitsOf } from "@/modules/catalog"
import { useWorkspaceId } from "@/hooks/workspaces"

/** What a block of an agent page was handed by its route; a loading boundary hands nothing (it knows no params). */
interface AgentRouteGiven {
    readonly workspaceId?: string | undefined
    readonly module?: string | undefined
    readonly installationId?: string | undefined
    readonly runId?: string | undefined
    readonly workflowKey?: string | undefined
}

/** The segments of an agent page address. */
type AgentRouteParams = {
    readonly module?: string
    readonly installation?: string
    readonly runId?: string
    readonly workflowKey?: string
    readonly version?: string
}

/** The agent type, instance, run, workflow and version a block draws. */
interface AgentRoute {
    readonly workspaceId: string
    readonly module: string
    readonly installationId: string
    readonly runId: string
    readonly workflowKey: string
    /** The version number of `/versions/<n>`, or 0 when the address names none. */
    readonly version: number
    /** Whether an agent of the type answers customers (every type but the internal ones). */
    readonly answersCustomers: boolean
    /** Whether the general settings of the type carry the reply limits of the chatbot. */
    readonly hasReplyLimits: boolean
}

/**
 * The agent page that is open. A route page hands its block the segments it awaited; the route's `loading.tsx` receives no params, so
 * the same block drawn there in its loading state reads them from the address (`/agents/<module>/<installation>/...`). The type is
 * whatever the address names: the catalogue of the workspace says what it is (an unknown type has no copy, and the guards of the
 * instance send the person back to the catalogue).
 */
export const useAgentRoute = (given: AgentRouteGiven = {}): AgentRoute => {
    const params = useParams<AgentRouteParams>()
    const workspaceId = useWorkspaceId()
    const named = given.module ?? params.module
    const module: string = named ?? ""
    const copy = useModuleCatalog().modules[module]
    const version = Number(params.version ?? "0")
    return {
        workspaceId: given.workspaceId ?? workspaceId,
        module,
        answersCustomers: answersCustomersOf(copy),
        hasReplyLimits: hasReplyLimitsOf(copy),
        installationId: given.installationId ?? params.installation ?? "",
        runId: given.runId ?? params.runId ?? "",
        workflowKey: given.workflowKey ?? params.workflowKey ?? "",
        version: Number.isInteger(version) ? version : 0,
    }
}
