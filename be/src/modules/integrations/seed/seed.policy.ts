import { tmpdir } from "node:os"
import { join } from "node:path"
import { Secret } from "@modules/platform/config"
import type { DataSeedOptions, SeedValues } from "./seed.options"

/** The settings of the git layer from the raw values: the cache defaults to a folder outside every code repository, the identity is kept as a secret and only the git author keys that are declared are passed on. */
export const seedOptionsOf = (values: SeedValues): DataSeedOptions => ({
    cache: values.cache ?? join(tmpdir(), "starci-seed-standards"),
    identity: values.identity === undefined ? undefined : new Secret(values.identity),
    gitEnv: Object.fromEntries(
        values.git.flatMap(({ key, value }): ReadonlyArray<readonly [string, string]> =>
            value === undefined ? [] : [[key, value]],
        ),
    ),
})
