import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { Secret } from "@modules/platform/config"
import type { SeedDatabaseConnector, SeedGitLibrary, SeedGitPort } from "./seed.port"
import type { DataSeedOptions } from "./seed.options"

/** Token of the options of the seed integration, exported so a spec can provide it. */
export const SEED_OPTIONS: unique symbol = Symbol("integrations.seed.options")

/** Token of the git layer of the data standard (`SeedGitPort`). */
export const SEED_GIT: unique symbol = Symbol("integrations.seed.git")

/** Token of the functions of the git layer of `@starci/seed`, exported so a spec can provide a double. */
export const SEED_GIT_LIBRARY: unique symbol = Symbol("integrations.seed.git-library")

/** Injects the options of the seed integration. Parameter type: DataSeedOptions. */
export const InjectSeedOptions = (): TypedParameterDecorator<DataSeedOptions> => injector<DataSeedOptions>(SEED_OPTIONS)

/** Injects the git layer of the data standard. Parameter type: SeedGitPort. */
export const InjectSeedGit = (): TypedParameterDecorator<SeedGitPort> => injector<SeedGitPort>(SEED_GIT)

/** Injects the functions of the git layer of `@starci/seed`. Parameter type: SeedGitLibrary. */
export const InjectSeedGitLibrary = (): TypedParameterDecorator<SeedGitLibrary> =>
    injector<SeedGitLibrary>(SEED_GIT_LIBRARY)

/** Token of the function of the postgres layer of `@starci/seed`, exported so a spec can provide a double. */
export const SEED_POSTGRES_LIBRARY: unique symbol = Symbol("integrations.seed.postgres-library")

/** Token of the builder of the dedicated connection of the whole-database store, exported so a spec can provide a double. */
export const SEED_DATABASE_CONNECT: unique symbol = Symbol("integrations.seed.database-connect")

/** Token of the owner connection URL of the whole-database store; provided only when the environment declares it. */
export const SEED_DATABASE_URL: unique symbol = Symbol("integrations.seed.database-url")

/** Token of the whole-database store (`database-all`), or null when the environment declares no owner connection. */
export const SEED_DATABASE_ALL: unique symbol = Symbol("integrations.seed.database-all")

/** Injects the builder of the dedicated owner connection. Parameter type: SeedDatabaseConnector. */
export const InjectSeedDatabaseConnector = (): TypedParameterDecorator<SeedDatabaseConnector> =>
    injector<SeedDatabaseConnector>(SEED_DATABASE_CONNECT)

/** Injects the owner connection URL. Parameter type: Secret. */
export const InjectSeedDatabaseUrl = (): TypedParameterDecorator<Secret> => injector<Secret>(SEED_DATABASE_URL)
