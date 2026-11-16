import { pictureUrlOf } from "@/modules/agentAvatar"
import { displayNameOf, installationLifecycleOf } from "./installations.status"
import type { Installation, InstallationStatus, OperatingMode } from "./installations.types"

/** The wire row of the back end `moduleInstallations` query (text fields; the closed sets are checked here). */
interface InstallationWire {
    readonly id: string
    readonly workspaceId: string
    readonly moduleKey: string
    readonly name: string
    readonly isMulti: boolean
    readonly agentId?: string | null
    readonly agentName: string
    readonly agentAvatarUrl?: string | null
    readonly agentAvatarPreset?: string | null
    readonly agentHandle: string
    readonly status: string
    readonly lifecycle: string
    readonly connectionNeeds: ReadonlyArray<{ readonly role: string; readonly providers: ReadonlyArray<string> }>
    readonly operatingMode: string
    readonly liveEnabled: boolean
    readonly activeContextVersionId?: string | null
    readonly activeVersion?: number | null
    readonly settings: unknown
    readonly createdAt: string
    readonly setupProgress: { readonly confirmed: number; readonly total: number }
}

const STATUSES: ReadonlyArray<InstallationStatus> = [
    "installing",
    "setup",
    "ready",
    "live",
    "paused",
    "needs_connection",
]
const MODES: ReadonlyArray<OperatingMode> = ["assist", "autopilot"]

/** The closed status a wire text names; an unknown text reads as being set up. */
const statusOf = (value: string): InstallationStatus => STATUSES.find((status) => status === value) ?? "setup"

/** The operating mode a wire text names; an unknown text reads as assist, the safe one. */
const operatingModeOf = (value: string): OperatingMode => MODES.find((mode) => mode === value) ?? "assist"

/** The settings object of a wire row; anything else reads as no settings. */
const settingsOf = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : {}

/** One installed agent as the screens read it. Every row the back end returned is kept: its type is whatever the back end named. */
const toInstallation = (row: InstallationWire): Installation => ({
    id: row.id,
    workspaceId: row.workspaceId,
    moduleKey: row.moduleKey,
    name: displayNameOf(row),
    isMulti: row.isMulti,
    agentId: row.agentId ?? null,
    agentAvatarUrl: pictureUrlOf({
        avatarUrl: row.agentAvatarUrl,
        avatarPreset: row.agentAvatarPreset,
        moduleKey: row.moduleKey,
    }),
    agentAvatarPreset: row.agentAvatarPreset ?? null,
    agentHandle: row.agentHandle,
    status: statusOf(row.status),
    lifecycle: installationLifecycleOf(row.lifecycle),
    connectionNeeds: row.connectionNeeds,
    operatingMode: operatingModeOf(row.operatingMode),
    liveEnabled: row.liveEnabled,
    activeContextVersionId: row.activeContextVersionId ?? null,
    activeVersion: row.activeVersion ?? null,
    settings: settingsOf(row.settings),
    createdAt: row.createdAt,
    setupProgress: { confirmed: row.setupProgress.confirmed, total: row.setupProgress.total },
})

/** The installed agents of the wire rows, oldest first. */
export const toInstallations = (rows: ReadonlyArray<InstallationWire>): ReadonlyArray<Installation> =>
    rows.map((entry) => toInstallation(entry)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
