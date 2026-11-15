import {
    agentHref,
    agentListHref,
    instancesOf,
    type AgentTab,
    type Installation,
} from "@/modules/installations"
import { AGENTS_ROUTE } from "@/modules/routes"

/** How a type-level url behaves: lead on (`page`), always stay on the list of instances (`list`), or always leave (`redirect`). */
export type TypeRouteMode = "page" | "list" | "redirect"

/** The query of a type-level url carried over to the instance url (the list flag stays behind). */
export const carriedQuery = (search: Readonly<Record<string, string | string[] | undefined>>): string => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(search)) {
        if (key === "list") continue
        const values = Array.isArray(value) ? value : [value]
        for (const one of values) if (one !== undefined) query.append(key, one)
    }
    return query.toString()
}

/**
 * Where a type-level url goes: the catalogue when the type is not installed, the only instance, else (several instances) the list
 * of instances, or null on the setup tab, which shows that list in place.
 */
export const typeTargetOf = (
    installations: ReadonlyArray<Installation>,
    module: string,
    tab: AgentTab,
    query: string,
): string | null => {
    const instances = instancesOf(installations, module)
    if (instances.length === 0) return AGENTS_ROUTE
    const [only] = instances
    if (instances.length === 1 && only !== undefined) return agentHref(module, only.id, tab, query)
    return tab === "setup" ? null : agentListHref(module)
}
