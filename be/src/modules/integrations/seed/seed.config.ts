import type { EnvSource } from "@modules/platform/config"
import type { DataSeedOptions } from "./seed.options"
import { seedOptionsOf } from "./seed.policy"

/** The git author variables the integration passes on (declared ones only). */
const GIT_KEYS: ReadonlyArray<string> = [
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
]

/**
 * Reads the settings of the data standard git layer: `SEED_STANDARD_CACHE` (default: `<os tmpdir>/starci-seed-standards`), the identity
 * `SOPS_AGE_KEY` (`EnvSource` reads a mounted `SOPS_AGE_KEY_FILE` into it) and the git author. Every key is optional so unrelated commands
 * boot without them.
 */
export const parseSeedConfig = (env: EnvSource): DataSeedOptions =>
    seedOptionsOf({
        cache: env.optional("SEED_STANDARD_CACHE"),
        identity: env.optional("SOPS_AGE_KEY"),
        git: GIT_KEYS.map((key) => ({ key, value: env.optional(key) })),
    })
