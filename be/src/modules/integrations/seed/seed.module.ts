import { Module, type DynamicModule, type Provider } from "@nestjs/common"
import type { StoreAdapter } from "@starci/seed"
import { createGitDriver, openReviewTree, pinRepository } from "@starci/seed/git"
import { postgresStore } from "@starci/seed/postgres"
import type { Secret } from "@modules/platform/config"
import { openOwnerConnection } from "@modules/platform/database"
import { SeedDatabaseService } from "./seed-database.service"
import {
    SEED_DATABASE_ALL,
    SEED_DATABASE_CONNECT,
    SEED_DATABASE_URL,
    SEED_GIT,
    SEED_GIT_LIBRARY,
    SEED_OPTIONS,
    SEED_POSTGRES_LIBRARY,
} from "./seed.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./seed.module-definition"
import type { SeedPostgresLibrary } from "./seed.port"
import { databaseAllOf } from "./seed-postgres.policy"
import { SeedGitService } from "./seed-git.service"

/** The providers of the whole-database store: the runner and the store when the environment declares the owner connection, else a null store. */
const databaseAllProviders = (url: Secret | undefined): ReadonlyArray<Provider> =>
    url === undefined
        ? [{ provide: SEED_DATABASE_ALL, useValue: null }]
        : [
              { provide: SEED_DATABASE_URL, useValue: url },
              SeedDatabaseService,
              {
                  provide: SEED_DATABASE_ALL,
                  inject: [SEED_POSTGRES_LIBRARY, SeedDatabaseService],
                  useFactory: (library: SeedPostgresLibrary, runner: SeedDatabaseService): StoreAdapter =>
                      databaseAllOf(library, runner),
              },
          ]

@Module({})
/**
 * The seed integration: `@starci/seed` (the data standard's ports, memory references, git layer and postgres store) composed with the
 * app's settings. It also builds the whole-database store `database-all` over a dedicated owner-role connection, or none when
 * `DATABASE_OWNER_URL` is not declared.
 */
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
                { provide: SEED_POSTGRES_LIBRARY, useValue: { postgresStore } },
                { provide: SEED_DATABASE_CONNECT, useValue: { connect: openOwnerConnection } },
                ...databaseAllProviders(options.backupDatabase),
            ],
            exports: [SEED_GIT, SEED_DATABASE_ALL],
        }
    }
}
