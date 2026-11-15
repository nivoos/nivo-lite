import { Injectable } from "@nestjs/common"
import { AgentWorkflowsAdminService } from "@modules/domain/agent-graphs"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import { ProviderTriggerStatesService } from "@modules/domain/provider-triggers"
import { WorkspaceSettingsService } from "@modules/domain/workspace-settings"
import { WorkspaceSeedError, WorkspaceSeedErrorCode, type SeedDoorsPort, type SeedNodeDoor, type SeedSwitchDoor } from "@modules/domain/workspace-seed"

@Injectable()
/**
 * The seed's door steps over the app's own doors, as the workspace's owner: the settings service for the time zone (it refuses a zone the
 * platform does not know) and the owner's node-settings door (`AgentWorkflowsAdminService.setNodeSettings`: owner seat, the workflow is the
 * agent's, every account judged against the agent's attachments and the sandbox switch, a new version written through the judged road).
 */
export class SeedStandardDoorsAdapter implements SeedDoorsPort {
    constructor(
        private readonly settings: WorkspaceSettingsService,
        private readonly installations: InstallationRecordsService,
        private readonly workflows: AgentWorkflowsAdminService,
        private readonly triggers: ProviderTriggerStatesService,
    ) {}

    async setTimeZone(workspaceId: string, _ownerId: string, timeZone: string): Promise<void> {
        await this.settings.update(workspaceId, { timeZone })
    }

    async setNodeSettings(workspaceId: string, ownerId: string, step: SeedNodeDoor): Promise<void> {
        const actor = { workspaceId, principalId: ownerId }
        const installation = await this.installations.firstOfModule(workspaceId, step.module)
        if (installation === null || installation === undefined) throw notFound()
        const listed = await this.workflows.list(actor, { installationId: installation.id, locale: "vi" })
        const workflow = listed.find((one) => one.key === step.workflow || `${step.module}.${one.key}` === step.workflow)
        if (workflow === undefined) throw notFound()
        await this.workflows.setNodeSettings(actor, {
            installationId: installation.id,
            workflowId: workflow.id,
            nodeKey: step.node,
            ...(step.mode === null ? {} : { mode: step.mode }),
            ...(step.accountIds === null ? {} : { accountIds: step.accountIds }),
        })
    }

    async setSwitch(workspaceId: string, ownerId: string, step: SeedSwitchDoor, overwriteUsed: boolean): Promise<"set" | "kept" | "used"> {
        const actor = { workspaceId, principalId: ownerId }
        const state = (await this.triggers.statesOf(actor, step.connectionId)).find((one) => one.name === step.trigger)
        if (state?.enabled === step.enabled) return "kept"
        if (state !== undefined && state.lastFiredAt !== null && !overwriteUsed) return "used"
        // An undeclared trigger is refused by the switch door itself with its typed code.
        await this.triggers.setEnabled(actor, { connectionId: step.connectionId, trigger: step.trigger, enabled: step.enabled, catchUp: false })
        return "set"
    }
}

const notFound = (): WorkspaceSeedError => new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field: "nodeSettings.workflow" } })
