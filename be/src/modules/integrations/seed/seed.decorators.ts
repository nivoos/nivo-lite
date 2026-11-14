import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { SeedGitLibrary, SeedGitPort } from "./seed.port"
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
