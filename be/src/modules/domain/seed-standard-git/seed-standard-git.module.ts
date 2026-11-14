import { Module, type DynamicModule } from "@nestjs/common"
import { SEED_STANDARD_DRIVER, SEED_STANDARD_TARGETS } from "@modules/domain/workspace-seed"
import { GitSeedStandardDriver } from "./git-seed-standard-driver.adapter"
import { GitSeedStandardTargets } from "./git-seed-standard-targets.adapter"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./seed-standard-git.module-definition"

@Module({})
/** Binds the seed standard seam of the workspace seed (`SEED_STANDARD_DRIVER`, `SEED_STANDARD_TARGETS`) to the data standard's git layer. */
export class SeedStandardGitModule extends ConfigurableModuleClass {
    /** Registers both adapters once in the app root. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                { provide: SEED_STANDARD_DRIVER, useClass: GitSeedStandardDriver },
                { provide: SEED_STANDARD_TARGETS, useClass: GitSeedStandardTargets },
            ],
            exports: [SEED_STANDARD_DRIVER, SEED_STANDARD_TARGETS],
        }
    }
}
