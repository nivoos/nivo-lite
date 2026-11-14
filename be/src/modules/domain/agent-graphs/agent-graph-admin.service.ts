import { Injectable } from "@nestjs/common"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import { WorkspaceMemberSeatsService } from "@modules/domain/workspace-members"
import type { Publisher } from "./agent-graph-publish.service"
import { AgentGraphSeedService } from "./agent-graph-seed.service"
import { AgentGraphViewService } from "./agent-graph-view.service"
import { AgentGraphsError, AgentGraphsErrorCode } from "./errors/agent-graphs.error"
import { AgentGraphsService } from "./agent-graphs.service"
import type { GraphVersionView } from "./agent-graphs.contracts"
import {
    localeOf,
    wireOfView,
    type AgentGraphRunWire,
    type AgentGraphWire,
    type OptionalLanguage,
} from "./policies/graph-wire.policy"

/** Who asks: the account and the workspace it acts in. */
export interface GraphActor {
    /** The workspace the request is made in. */
    readonly workspaceId: string
    /** The account making the request. */
    readonly principalId: string
}

/** Who can answer one ask of the graph, and who was left out: the shape the coverage door still answers (always empty). */
export interface AskCoverage {
    /** The node that asks. */
    readonly nodeKey: string
    /** The branch that asks, or null for an approval step. */
    readonly branchKey: string | null
    /** The top of the amounts the branch covers, or null when it has none. */
    readonly top: number | null
    /** The names of the people a request would go to. */
    readonly approvers: ReadonlyArray<string>
    /** The people of the group left out, with the reason. */
    readonly excluded: ReadonlyArray<{ readonly name: string; readonly reason: string }>
    /** False when nobody can approve up to the top of the branch. */
    readonly covered: boolean
}

@Injectable()
/**
 * The READ door of an agent's action graph (owner ruling R89: a stored graph is exactly an installed template version; no door edits
 * one): every call checks that the account holds an active seat as owner or manager of the workspace, then reads the graph of one agent.
 * The first open of an agent seeds its graph, so the reader never meets an agent with none. A node's settings are set on its workflow
 * (`AgentWorkflowsAdminService.setNodeSettings`).
 */
export class AgentGraphAdminService {
    constructor(
        private readonly seats: WorkspaceMemberSeatsService,
        private readonly graphs: AgentGraphsService,
        private readonly seed: AgentGraphSeedService,
        private readonly view: AgentGraphViewService,
        private readonly installations: InstallationRecordsService,
    ) {}

    /** The graph of the agent for the editor, seeded on the first open. */
    async open(actor: GraphActor, agentId: string, language: OptionalLanguage): Promise<AgentGraphWire> {
        const locale = localeOf(language)
        await this.publisherOf(actor)
        if ((await this.graphs.stateOfAgent(actor.workspaceId, agentId)) === null) {
            const installation = await this.installations.ofAgent(actor.workspaceId, agentId)
            if (installation !== null) await this.seed.ensureFor(installation.id, locale)
        }
        return wireOfView(await this.view.viewOf(actor.workspaceId, agentId, locale))
    }

    /** The versions of the agent, newest first. */
    async versions(actor: GraphActor, agentId: string): Promise<ReadonlyArray<GraphVersionView>> {
        await this.publisherOf(actor)
        return this.graphs.versionsOf(actor.workspaceId, agentId)
    }

    /**
     * The trace of the run of a work item through the graph: none exists. No engine gate walks a graph (2026-11-13), so no graph decision is
     * written; the door stays for the screen that still asks and answers not found.
     */
    async run(actor: GraphActor, _workItemId: string): Promise<AgentGraphRunWire> {
        await this.publisherOf(actor)
        throw new AgentGraphsError({ code: AgentGraphsErrorCode.RunNotFound })
    }

    /**
     * Who can answer each ask of the draft graph: none is computed. The coverage read the approvers' grants for an authority action, and
     * the rules decide nothing since the engine gate was removed (2026-11-13); the door stays for the screen that still asks.
     */
    async coverage(actor: GraphActor, _agentId: string): Promise<ReadonlyArray<AskCoverage>> {
        await this.publisherOf(actor)
        return []
    }

    private async publisherOf(actor: GraphActor): Promise<Publisher> {
        const seat = await this.seats.activeSeatOfUser(actor.workspaceId, actor.principalId)
        if (seat === null || (seat.role !== "owner" && seat.role !== "manager"))
            throw new AgentGraphsError({ code: AgentGraphsErrorCode.Forbidden })
        return { memberId: seat.memberId, role: seat.role }
    }
}
