import { pickCopy, pickCopyList, type ModuleCopy } from "@/modules/catalog"
import { workspaceHref } from "@/modules/routes"
import { instancesOf } from "./installations.instances"
import { agentHref, agentListHref } from "./installations.routes"
import { foldText } from "./installations.status"
import type { Installation } from "./installations.types"

/** One role of the catalogue in the reader language, with whether an agent of it is installed. */
export interface CatalogRole {
    readonly key: string
    readonly categoryKey: string
    /** The name, description and points folded for matching, in both languages. */
    readonly searchText: string
    /** At least one agent of this role is installed. */
    readonly installed: boolean
    /** How many agents of this role are installed. */
    readonly installedCount: number
    /** Where another agent of an installed role that runs several is added by name; null when the card installs instead. */
    readonly addHref: string | null
    readonly isEarly: boolean
    readonly name: string
    readonly description: string
    readonly points: ReadonlyArray<string>
    readonly mascot: string
    /** Where the installed agent of this role opens; null when none is installed. */
    readonly openHref: string | null
    /** The providers the role works through, as the provider ids the connections page knows; empty when it needs none. */
    readonly providers: ReadonlyArray<string>
}

/** A category of the catalogue the back end served. */
interface RoleCategory {
    readonly key: string
    readonly label: { readonly vi: string; readonly en: string }
}

/** What the roles are built from: the catalogue the back end served the workspace, and the agents it has. */
interface RolesInput {
    readonly modules: ReadonlyArray<ModuleCopy>
    readonly categories: ReadonlyArray<RoleCategory>
    /** The installed agents; undefined while they are read. */
    readonly installations: ReadonlyArray<Installation> | undefined
    readonly workspaceId: string
    readonly locale: "vi" | "en"
}

/** The name, description, points and group of a role folded for matching, in both languages. */
const searchTextOf = (copy: ModuleCopy, category: RoleCategory | undefined): string =>
    foldText(
        [
            copy.name.vi,
            copy.name.en,
            copy.shortName.vi,
            copy.shortName.en,
            copy.description.vi,
            copy.description.en,
            ...copy.points.vi,
            ...copy.points.en,
            category?.label.vi ?? "",
            category?.label.en ?? "",
        ].join(" "),
    )

/**
 * The roles still to add, one per module the back end served this workspace (a single-instance role that is installed does not repeat).
 * Nothing is added or dropped here: the roles ARE the catalogue.
 */
export const catalogRolesOf = (input: RolesInput): ReadonlyArray<CatalogRole> =>
    input.modules.flatMap((copy): ReadonlyArray<CatalogRole> => {
        const instances = input.installations === undefined ? [] : instancesOf(input.installations, copy.key)
        const installation = instances[0]
        if (installation !== undefined && !copy.multiInstance) return []
        // `available: false` is the template's declaration that the module is not added from the catalogue (the back end refuses it): not
        // offered, but an agent of it the workspace already has stays listed and opens.
        if (!copy.available && installation === undefined) return []
        const category = input.categories.find((entry) => entry.key === copy.category)
        return [
            {
                key: copy.key,
                categoryKey: copy.category,
                installed: installation !== undefined,
                installedCount: instances.length,
                addHref:
                    installation !== undefined && copy.multiInstance && copy.available
                        ? workspaceHref(input.workspaceId, agentListHref(copy.key))
                        : null,
                isEarly: copy.status === "early",
                searchText: searchTextOf(copy, category),
                name: pickCopy(copy.name, input.locale),
                description: pickCopy(copy.description, input.locale),
                points: pickCopyList(copy.points, input.locale),
                mascot: copy.mascot,
                openHref:
                    installation === undefined
                        ? null
                        : workspaceHref(input.workspaceId, agentHref(copy.key, installation.id)),
                providers: copy.connectionProviders,
            },
        ]
    })
