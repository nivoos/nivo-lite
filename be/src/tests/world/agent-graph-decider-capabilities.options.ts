import type { DynamicModule } from "@nestjs/common"
import { AgentGraphsModule } from "@modules/domain/agent-graphs"
import { EventsModule } from "@modules/domain/events"
import { StaffModule } from "@modules/domain/staff"
import { WorkspaceMembersModule } from "@modules/domain/workspace-members"
import { ENGINE_STORE_MODULE } from "./entity-engine-store.options"
import { QUEUE_MODULES } from "./test-capabilities.options"

/** The graph store as the gateway uses it (the store, the rights and the decision ledger), with no fact reader of a module. */
const AGENT_GRAPH_RIGHTS_MODULES: ReadonlyArray<DynamicModule> = [
    ...QUEUE_MODULES,
    ENGINE_STORE_MODULE,
    EventsModule.register({ isGlobal: true }),
    StaffModule.register({ isGlobal: true }),
    WorkspaceMembersModule.register({ isGlobal: true }),
    AgentGraphsModule.register({ isGlobal: true, rightsOnly: true }),
]

/** The graph store as the apps that read graphs use it: the store's modules (no proposal: no door edits a graph, R89). */
export const AGENT_GRAPH_STORE_MODULES: ReadonlyArray<DynamicModule> = AGENT_GRAPH_RIGHTS_MODULES
