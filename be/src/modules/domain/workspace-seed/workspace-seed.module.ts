import { Module, type DynamicModule } from "@nestjs/common"
import { BrainPolicyStoreService } from "@modules/domain/brain"
import { ENTERPRISE_ROSTER } from "@modules/domain/channel-provisioning"
import { GraphSeedService } from "./graph-seed.service"
import { RosterSeedService } from "./roster-seed.service"
import { SeedActivationService } from "./seed-activation.service"
import { SeedReceiptsService } from "./seed-receipts.service"
import { SeedStandardExportService } from "./seed-standard-export.service"
import { SeedStandardService } from "./seed-standard.service"
import { SetSeedService } from "./set-seed.service"
import { SEED_AGENTS, SEED_AUTH } from "./workspace-seed.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./workspace-seed.module-definition"
import { WorkspaceSeedService } from "./workspace-seed.service"
import { WorkflowResetCommandService } from "./workflow-reset-command.service"
import { WorkflowResetService } from "./workflow-reset.service"

@Module({})
/**
 * The workspace seed: accounts through the own-auth account doors, the workspace and memberships through their capabilities, and
 * the graph seed of the installed templates, written through the owner class the app root binds behind the agents port.
 */
export class WorkspaceSeedModule extends ConfigurableModuleClass {
    /** Registers the capability once in the cli app; the port is bound to the owner class the options name. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                { provide: SEED_AUTH, useExisting: options.auth },
                { provide: SEED_AGENTS, useClass: options.ports.agents },
                SeedActivationService,
                WorkspaceSeedService,
                GraphSeedService,
                RosterSeedService,
                // The set seed writes the policy judgement of its truths itself (model `seed`): the one row store of the judgements, nothing else of the brain.
                BrainPolicyStoreService,
                SetSeedService,
                // The seed standards (R98, R101-R104): the bring-up's applier, its receipts, the export door; the data driver behind
                // SEED_STANDARD_DRIVER / SEED_STANDARD_TARGETS is bound by the composition root once the harness's driver is wired.
                SeedReceiptsService,
                SeedStandardService,
                SeedStandardExportService,
                // The enterprise seed's roster step (ruling R17): the enterprise seed of channel-provisioning calls it after the identifier is set.
                { provide: ENTERPRISE_ROSTER, useExisting: RosterSeedService },
                WorkflowResetService,
                WorkflowResetCommandService,
            ],
            exports: [WorkspaceSeedService, GraphSeedService, RosterSeedService, SetSeedService, SeedStandardService, SeedStandardExportService, ENTERPRISE_ROSTER, WorkflowResetService, WorkflowResetCommandService],
        }
    }
}
