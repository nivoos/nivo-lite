import { Module, type DynamicModule } from "@nestjs/common"
import { createGitDriver, openReviewTree, pinRepository } from "@starci/seed/git"
import { SEED_GIT, SEED_GIT_LIBRARY, SEED_OPTIONS } from "./seed.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./seed.module-definition"
import { SeedGitService } from "./seed-git.service"

@Module({})
/** The seed integration: `@starci/seed` (the data standard's ports, memory references and git layer) composed with the app's settings. */
export class DataSeedModule extends ConfigurableModuleClass {
    /** Registers the integration once per app with the options parsed at the composition root. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                { provide: SEED_OPTIONS, useValue: options },
                { provide: SEED_GIT_LIBRARY, useValue: { pinRepository, openReviewTree, createGitDriver } },
                { provide: SEED_GIT, useClass: SeedGitService },
            ],
            exports: [SEED_GIT],
        }
    }
}
