import { Injectable } from "@nestjs/common"
import type { JsonValue } from "@modules/integrations/seed"
import { WorkspaceSettingsService } from "@modules/domain/workspace-settings"
import type { DoorRow, SetDoor, WorkspaceRef } from "./data-stores.contracts"
import { DataStoresError, DataStoresErrorCode } from "./errors/data-stores.error"
import { WORKSPACE_ROW_KEY, WORKSPACE_SET, recordObjectOf } from "./data-stores.policy"

@Injectable()
/**
 * The set `workspace`: the settings row of the scope's workspace, one row under the key `settings` (the workspace itself is named by the
 * scope, so its identifier is not repeated inside). Members: `name`, `timeZone`, `theme` (the brand parameters, or null for the NIVO
 * default). A member the record leaves out stays as it is. Written through `WorkspaceSettingsService`, which validates each member; the
 * logo address, billing, plan and enterprise identifier are never carried.
 */
export class WorkspaceSettingsDoor implements SetDoor {
    readonly set: string = WORKSPACE_SET

    constructor(private readonly settings: WorkspaceSettingsService) {}

    /** The workspace's one settings row; its id is the workspace id. */
    async list(workspace: WorkspaceRef): Promise<ReadonlyArray<DoorRow>> {
        const facts = await this.settings.get(workspace.id)
        const theme = await this.settings.getTheme(workspace.id)
        const record: JsonValue = {
            name: facts.name,
            theme: theme === null ? null : { ...theme },
            timeZone: facts.timeZone,
        }
        return [{ key: WORKSPACE_ROW_KEY, id: workspace.id, record }]
    }

    /** Updates the settings in place; the only key is `settings`. */
    async write(workspace: WorkspaceRef, key: string, record: JsonValue): Promise<string> {
        const members = recordObjectOf(record)
        if (key !== WORKSPACE_ROW_KEY || members === null)
            throw new DataStoresError({ code: DataStoresErrorCode.RecordInvalid })
        const { name, timeZone, theme } = members
        if (
            (name !== undefined && typeof name !== "string") ||
            (timeZone !== undefined && typeof timeZone !== "string")
        ) {
            throw new DataStoresError({ code: DataStoresErrorCode.RecordInvalid })
        }
        await this.settings.update(workspace.id, {
            ...(name === undefined ? {} : { name }),
            ...(timeZone === undefined ? {} : { timeZone }),
        })
        if (theme !== undefined) await this.settings.setTheme(workspace.id, theme)
        return workspace.id
    }
}
