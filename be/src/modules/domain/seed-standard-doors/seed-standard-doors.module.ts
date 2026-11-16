import { Module, type DynamicModule } from "@nestjs/common"
import { SEED_DOORS } from "@modules/domain/workspace-seed"
import { WorkspaceSettingsService } from "@modules/domain/workspace-settings"
import { SeedStandardDoorsAdapter } from "./seed-standard-doors.adapter"

@Module({})
/** Binds the seed's door steps (`SEED_DOORS`) to the app's own doors (the settings service and the owner's node-settings door). */
export class SeedStandardDoorsModule {
    /** Registers the adapter once in the app root that runs the seed. */
    static register(options: { readonly isGlobal?: boolean }): DynamicModule {
        return {
            module: SeedStandardDoorsModule,
            global: options.isGlobal === true,
            providers: [WorkspaceSettingsService, { provide: SEED_DOORS, useClass: SeedStandardDoorsAdapter }],
            exports: [SEED_DOORS],
        }
    }
}
