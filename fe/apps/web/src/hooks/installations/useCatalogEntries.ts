"use client"

import { useLocale } from "next-intl"
import { useModuleCatalog } from "@/hooks/moduleCatalog"
import { useQueryAgentCatalogSwr } from "@/hooks/swr"
import { useWorkspaceId } from "@/hooks/workspaces"
import { slotOfReads } from "@/hooks/slot"
import type { AgentCatalogEntry } from "@/modules/agentCatalog"
import { pickCopy } from "@/modules/catalog"
import {
    type AgentLifecycle,
    type SetupProgress,
    installationPersonName,
    agentHref,
    agentLifecycleOf,
    agentLifecycleTone,
    isSetupPending,
    catalogRolesOf,
    type CatalogRole,
} from "@/modules/installations"
import { workspaceHref } from "@/modules/routes"
import type { DataSlot } from "@/modules/types"
import { useInstallations } from "./useInstallations"
import { useInstanceChannels } from "./useInstanceChannels"

/** One installed agent as a person of the team. */
export interface InstalledAgent {
    readonly id: string
    /** The agent row of the instance, the key its grants and knowledge counts are read by; null before it has one. */
    readonly agentId: string | null
    readonly moduleKey: string
    readonly handle: string
    readonly name: string
    /** The seed of the generated avatar. */
    readonly seed: string
    readonly avatarUrl: string | null
    /** The preset the owner chose; "initials" draws the initials. */
    readonly avatarPreset: string | null
    readonly roleName: string
    readonly lifecycle: AgentLifecycle
    readonly tone: ReturnType<typeof agentLifecycleTone>
    readonly href: string
    /** The names of the channels its agent is bound to; empty when none. */
    readonly channels: ReadonlyArray<string>
    /** The required setup gates confirmed, of all of them. */
    readonly setupProgress: SetupProgress
    /** The connections granted to the agent and what it reads; undefined while the read has no answer for it. */
    readonly catalog: AgentCatalogEntry | undefined
}

type ModuleCatalog = ReturnType<typeof useModuleCatalog>

/** The category filter entries in the reader language, as the catalogue of the workspace serves them. */
const categoriesOf = (
    catalog: ModuleCatalog,
    locale: "vi" | "en",
): ReadonlyArray<{ readonly key: string; readonly label: string }> =>
    catalog.categories.map((category) => ({
        key: category.key,
        label: pickCopy(category.label, locale),
    }))

/** The installed agents, the roles still to add (a single-instance role that is installed does not repeat), and the categories. */
export const useCatalogEntries = (): {
    readonly agents: ReadonlyArray<InstalledAgent>
    readonly roles: ReadonlyArray<CatalogRole>
    readonly categories: ReadonlyArray<{ readonly key: string; readonly label: string }>
    readonly slot: DataSlot<boolean>
    readonly reload: () => void
} => {
    const locale = useLocale() === "en" ? "en" : "vi"
    const workspaceId = useWorkspaceId()
    const { read: installationsRead, installations, reload: reloadInstallations } = useInstallations()
    const catalog = useModuleCatalog()
    const agentCatalog = useQueryAgentCatalogSwr()
    const channelsOf = useInstanceChannels()
    const roles = catalogRolesOf({
        modules: catalog.list,
        categories: catalog.categories,
        installations,
        workspaceId,
        locale,
    })
    const agents = (installations ?? []).map((installation): InstalledAgent => {
        const copy = catalog.modules[installation.moduleKey]
        const lifecycle = agentLifecycleOf(installation)
        return {
            id: installation.id,
            agentId: installation.agentId,
            moduleKey: installation.moduleKey,
            handle: installation.agentHandle,
            name: installationPersonName(installation),
            seed: installation.agentId ?? installation.id,
            avatarUrl: installation.agentAvatarUrl,
            avatarPreset: installation.agentAvatarPreset,
            roleName: copy === undefined ? "" : pickCopy(copy.name, locale),
            lifecycle,
            tone: agentLifecycleTone(lifecycle),
            href: workspaceHref(
                workspaceId,
                agentHref(installation.moduleKey, installation.id, isSetupPending(lifecycle) ? "setup" : "workbench"),
            ),
            channels: channelsOf(installation.agentId),
            setupProgress: installation.setupProgress,
            catalog: agentCatalog.data?.find((entry) => entry.agentId === installation.agentId),
        }
    })
    const categories = categoriesOf(catalog, locale)
    const slot = slotOfReads([installationsRead, catalog.read, agentCatalog], () => true)
    return {
        agents,
        roles,
        categories,
        slot,
        reload: () => {
            reloadInstallations()
            catalog.reload()
            void agentCatalog.mutate()
        },
    }
}
