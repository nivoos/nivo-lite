export { allGatesConfirmed, gateEntry, gateHint, gateLabel, gatesOf, snapshotOf } from "./installations.gates"
export { toInstallations } from "./installations.wire"
export { catalogRolesOf } from "./installations.roles"
export type { CatalogRole } from "./installations.roles"
export { cleanInstanceName, instanceNameKey, instancesOf, nextInstanceName } from "./installations.instances"
export {
    displayNameOf,
    installationPersonName,
    agentLifecycleOf,
    agentLifecycleTone,
    agentSubtitleOf,
    isSetupPending,
    foldText,
} from "./installations.status"
export type { AgentLifecycle } from "./installations.status"
export {
    IDENTITY_PARAM,
    IDENTITY_QUERY,
    OWNER_SETUP_NOTICE,
    agentHref,
    agentListHref,
    setupGeneralHref,
    workflowsHref,
} from "./installations.routes"
export type { AgentTab } from "./installations.routes"
export type {
    ContextVersion,
    GateEntry,
    GateEvidence,
    GateStatus,
    Installation,
    InstallationConnectionNeed,
    InstallationLifecycle,
    SetupFact,
    SetupMessage,
    SetupProgress,
    SetupRevision,
    SetupSession,
} from "./installations.types"
