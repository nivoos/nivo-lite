import type { ModuleServer } from "./module.types"

/** What a package ships, as far as the availability rule reads it (a plugin's `servers`, `modules` and `templateAgents`). */
export interface ModuleShipment {
    /** The catalogue templates of the package's modules. */
    readonly servers?: ReadonlyArray<ModuleServer> | undefined
    /** The package's module declarations (reads, actions, the workbench the module's desk draws on). */
    readonly modules?: ReadonlyArray<{ readonly key: string }> | undefined
    /** The package's template agents: the agent of a module is the one with the module's key. */
    readonly templateAgents?: ReadonlyArray<{ readonly key: string; readonly graphs: ReadonlyArray<unknown> }> | undefined
}

/** One way a module offered in the catalogue is not built. */
export interface ModuleAvailabilityProblem {
    readonly code: "MODULE_AVAILABLE_NO_DECLARATION" | "MODULE_AVAILABLE_NO_AGENT" | "MODULE_AVAILABLE_NO_WORKBENCH"
    /** The module key. */
    readonly key: string
    /** The workbench key the template names, for `MODULE_AVAILABLE_NO_WORKBENCH`. */
    readonly workbench?: string
}

/**
 * What is wrong with the modules a package offers: a template that does not declare `available: false` is offered for adding, so it must
 * be built: a module declaration, at least one graph on the template agent of its key, and, when it names a workbench, a declaration
 * registered under that workbench key. A module not built yet declares `available: false` and is exempt. Pure.
 */
export const moduleAvailabilityProblems = (shipment: ModuleShipment): ReadonlyArray<ModuleAvailabilityProblem> => {
    const declared = new Set((shipment.modules ?? []).map((module) => module.key))
    const agents = shipment.templateAgents ?? []
    return (shipment.servers ?? []).flatMap((server): ReadonlyArray<ModuleAvailabilityProblem> => {
        const { key, template } = server
        if (template.available === false) return []
        const problems: Array<ModuleAvailabilityProblem> = []
        if (!declared.has(key)) problems.push({ code: "MODULE_AVAILABLE_NO_DECLARATION", key })
        if (!agents.some((agent) => agent.key === key && agent.graphs.length > 0)) {
            problems.push({ code: "MODULE_AVAILABLE_NO_AGENT", key })
        }
        if (template.workbench !== null && !declared.has(template.workbench)) {
            problems.push({ code: "MODULE_AVAILABLE_NO_WORKBENCH", key, workbench: template.workbench })
        }
        return problems
    })
}
