import { Injectable, Optional } from "@nestjs/common"
import { AgentBindingsService } from "@modules/domain/agent-connections"
import { ConnectionGrantsService } from "@modules/domain/connection-grants"
import { ConnectionsService, type ConnectionActor } from "@modules/domain/connections"
import {
    INSTALLED,
    WEBSITE_CHANNEL,
    customerChannelProviders,
    installedFrontDoorsOf,
    type FrontDoorChannel,
} from "@modules/domain/installed-plugins"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import { ModulesService } from "@modules/domain/modules"
import { AgentAccountsService } from "@modules/domain/tools"
import { WorkspaceEnterpriseService, WorkspacesService } from "@modules/domain/workspaces"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import type { Locale } from "@modules/platform/i18n"
import { AgentInstanceCreationService } from "./agent-instance-creation.service"
import type { CreatedAgent } from "./agent-instances.contracts"
import { AgentInstancesLogEvent } from "./agent-instances.log-events"
import { AgentInstancesError, AgentInstancesErrorCode } from "./errors/agent-instances.error"

/** The language the installed agent is named in, as the seed names the agents it installs. */
const FRONT_DOOR_LOCALE: Locale = "vi"

/** The channel already has its front door: left exactly as it is. */
type HeldFrontDoor = { readonly kind: "held"; readonly module: string; readonly agentId: string | null }

/** The front door the workspace already holds, with the installation behind it. */
type HeldInstallation = { readonly door: HeldFrontDoor; readonly installationId: string }

/**
 * What making sure a customer channel has an owning agent found or did: no installed template declares a front door for the channel (nobody
 * can answer it: the capability is missing), the channel already has its front door (left exactly as it is), the workspace's existing front
 * door was attached to the new connection, or the front door was installed for this connection.
 */
export type FrontDoorOutcome =
    | { readonly kind: "none" }
    | HeldFrontDoor
    | { readonly kind: "attached"; readonly module: string; readonly agentId: string }
    | { readonly kind: "installed"; readonly module: string; readonly agentId: string; readonly installationId: string }

@Injectable()
/**
 * A customer channel (Zalo OA, Telegram, Meta, the website form) has exactly ONE front door: the agent that answers its stream. Connecting
 * the channel makes sure it has one. Which template is the front door is read from the installation, never named here: the template agents
 * with a graph that wakes on a customer message of the channel (`installed-channels.policy`), that the workspace may hold, a private
 * plugin's template before a public one (so an enterprise workspace's own front door owns the stream and the shared one is not installed
 * beside it), then the installation's order. When the workspace holds none of them the winner is installed through the same creation the
 * agents page uses (the installation, its workflows, the rights on the connected providers, the connection's inbound grant); when it
 * already holds some, the best of the ones it holds is ATTACHED to the new connection with the same writers (the inbound binding, the
 * rights on the connected providers); a connection that already has its front door is left as it is. Idempotent. A failure to install or
 * attach is thrown (`FrontDoorFailed`) and marks the connection in error, so a channel is never left connected with nobody behind it; what a
 * failed install made stays (forward only) and the next run finds it as the held front door and finishes it (rights, workflows). The raw
 * delivery is stored by the intake whether or not an agent answers.
 */
export class ChannelFrontDoorService {
    constructor(
        private readonly connections: ConnectionsService,
        private readonly installations: InstallationRecordsService,
        private readonly catalog: ModulesService,
        private readonly creation: AgentInstanceCreationService,
        private readonly workspaces: WorkspacesService,
        private readonly grants: ConnectionGrantsService,
        private readonly bindings: AgentBindingsService,
        private readonly accounts: AgentAccountsService,
        @InjectLogger() private readonly logger: Logger,
        @Optional() private readonly enterprise?: WorkspaceEnterpriseService,
    ) {}

    /**
     * Makes sure the channel connection has its front door installed and attached; the connection is of the actor's workspace. A connection
     * that is no customer channel (a bank feed, a mailbox) has none: `none`, without a warning.
     */
    async ensureForConnection(actor: ConnectionActor, connectionId: string): Promise<FrontDoorOutcome> {
        const connection = await this.connections.get(actor.workspaceId, connectionId)
        if (!customerChannelProviders().has(connection.provider)) return { kind: "none" }
        const outcome = await this.ensure(actor.workspaceId, connection.provider, connection.id)
        // The error an earlier failed run left on the connection says its front door could not be made: it has one now, so the error clears.
        if (outcome.kind !== "none" && connection.status === "error" && connection.lastError === AgentInstancesErrorCode.FrontDoorFailed) {
            await this.connections.patch(actor.workspaceId, connection.id, { status: "connected", lastError: null })
        }
        return outcome
    }

    /** Makes sure the workspace's website form has its front door installed: the form has no connection to attach. */
    ensureForWebsite(actor: ConnectionActor): Promise<FrontDoorOutcome> {
        return this.ensure(actor.workspaceId, WEBSITE_CHANNEL, null)
    }

    private async ensure(
        workspaceId: string,
        channel: FrontDoorChannel,
        connectionId: string | null,
    ): Promise<FrontDoorOutcome> {
        const open = await this.openOf(workspaceId, installedFrontDoorsOf(channel))
        const [wanted] = open
        if (wanted === undefined) {
            this.logger.warn(AgentInstancesLogEvent.FrontDoorMissing, { workspaceId, channel })
            return { kind: "none" }
        }
        try {
            const held = await this.heldOf(workspaceId, open)
            if (held === null) return await this.installed(workspaceId, channel, wanted, connectionId)
            if (connectionId === null || held.door.agentId === null) return held.door
            return await this.attached(workspaceId, held, connectionId)
        } catch (cause: unknown) {
            this.logger.error(AgentInstancesLogEvent.FrontDoorFailed, cause, { workspaceId, channel, module: wanted })
            if (connectionId !== null) await this.markInError(workspaceId, connectionId)
            throw new AgentInstancesError({
                code: AgentInstancesErrorCode.FrontDoorFailed,
                params: { module: wanted },
                cause,
            })
        }
    }

    /** Installs the winner for the workspace as its owner would on the agents page, answering the connection when there is one. */
    private async installed(
        workspaceId: string,
        channel: FrontDoorChannel,
        module: string,
        connectionId: string | null,
    ): Promise<FrontDoorOutcome> {
        const created = await this.install(workspaceId, module, connectionId)
        this.logger.info(AgentInstancesLogEvent.FrontDoorInstalled, { workspaceId, channel, module })
        return { kind: "installed", module, agentId: created.agentId, installationId: created.installationId }
    }

    /**
     * Gives the workspace's front door the new connection: the inbound binding (the agents page's grant writer, which refuses a second
     * front door on one stream) and the rights on the connected providers (the attach the creation makes, which leaves a right the agent
     * already holds as it is). A connection that already has its front door is left as it is: that agent is the answer.
     */
    private async attached(workspaceId: string, held: HeldInstallation, connectionId: string): Promise<FrontDoorOutcome> {
        const { module, agentId } = held.door
        if (agentId === null) return held.door
        const ownerId = await this.requireOwner(workspaceId, module)
        const holder = await this.bindings.owningAgentOf(workspaceId, connectionId)
        if (holder === null) {
            await this.grants.setGrant({ principalId: ownerId, workspaceId }, connectionId, agentId, true)
        }
        const rights = await this.accounts.attachDefaults({ workspaceId, agentId, moduleKey: module }, null, ownerId)
        if (!rights.ok) {
            throw new AgentInstancesError({ code: AgentInstancesErrorCode.FrontDoorFailed, params: { module } })
        }
        // An install that failed before its workflows left the agent without them: they are made now, and only the missing ones.
        await this.creation.finishWorkflows({ workspaceId, installationId: held.installationId, agentId, moduleKey: module })
        if (holder !== null) return { kind: "held", module, agentId: holder }
        this.logger.info(AgentInstancesLogEvent.FrontDoorAttached, { workspaceId, connectionId, module })
        return { kind: "attached", module, agentId }
    }

    /** The modules of the list the workspace may hold, in the list's order. */
    private async openOf(workspaceId: string, modules: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
        const checks = await Promise.all(
            modules.map(async (module) => ({
                module,
                open:
                    this.enterprise === undefined
                        ? INSTALLED.isOpenTo(module, null)
                        : await this.enterprise.opens(workspaceId, module),
            })),
        )
        return checks.filter((check) => check.open).map((check) => check.module)
    }

    /** The agent of the best of these modules the workspace already holds (not removed), or null when it holds none. */
    private async heldOf(workspaceId: string, modules: ReadonlyArray<string>): Promise<HeldInstallation | null> {
        const installed = await this.installations.list(workspaceId)
        for (const module of modules) {
            const found = installed.find((record) => record.moduleKey === module)
            if (found !== undefined) return { door: { kind: "held", module, agentId: found.agentId }, installationId: found.id }
        }
        return null
    }

    private async requireOwner(workspaceId: string, module: string): Promise<string> {
        const ownerId = await this.workspaces.ownerIdOf(workspaceId)
        if (ownerId === null) {
            throw new AgentInstancesError({ code: AgentInstancesErrorCode.FrontDoorFailed, params: { module } })
        }
        return ownerId
    }

    /** Installs the module for the workspace as its owner would on the agents page, answering the connection when there is one. */
    private async install(workspaceId: string, moduleKey: string, connectionId: string | null): Promise<CreatedAgent> {
        const ownerId = await this.requireOwner(workspaceId, moduleKey)
        const module = await this.catalog.find(moduleKey)
        return this.creation.create(ownerId, {
            workspaceId,
            moduleKey,
            locale: FRONT_DOOR_LOCALE,
            name: module.agent.label[FRONT_DOOR_LOCALE],
            handle: null,
            avatarPreset: null,
            avatarPath: null,
            connectionIds: connectionId === null ? [] : [connectionId],
            startFrom: "default",
            copyFrom: null,
        })
    }

    /** Marks the connection failing for the owner to see: the typed failed row of a front door that could not be made. */
    private async markInError(workspaceId: string, connectionId: string): Promise<void> {
        await this.connections.patch(workspaceId, connectionId, {
            status: "error",
            lastError: AgentInstancesErrorCode.FrontDoorFailed,
        })
    }
}
