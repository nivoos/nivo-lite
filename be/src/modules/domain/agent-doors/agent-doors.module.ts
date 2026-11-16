import { Module, type DynamicModule } from "@nestjs/common"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./agent-doors.module-definition"
import { DoorPressesService } from "./door-presses.service"
import { HoldReleaseDoorService } from "./hold-release-door.service"
import { ScheduledItemsService } from "./scheduled-items.service"

@Module({})
/**
 * The owner's doors onto the agents' work (package D1): the schedule list with "run now" and "hand back to the agent" for a held
 * conversation (a person's "do not contact" is the contact's consent fact, `ContactsService.setConsent`, not a door here). Each is owner- or manager-gated and acts through
 * the engine's own paths; `agent_door_presses` remembers who pressed and when. It needs the work core, the schedules, the threads, the
 * graphs, the installations and the members of the app, all registered globally.
 */
export class AgentDoorsModule extends ConfigurableModuleClass {
    /** Registers the capability once per app that serves people. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                DoorPressesService,
                ScheduledItemsService,
                HoldReleaseDoorService,
            ],
            exports: [
                DoorPressesService,
                ScheduledItemsService,
                HoldReleaseDoorService,
            ],
        }
    }
}
