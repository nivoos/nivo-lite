import type { Secret } from "@modules/platform/config"

/** The settings of the git layer of the data standard: where repositories are mirrored, which identity opens sealed files, how git signs. */
export interface DataSeedOptions {
    /** A directory outside every code repository: one bare mirror per pinned repository lives under it. */
    readonly cache: string
    /** The environment's age identity (`SOPS_AGE_KEY`, mounted as `SOPS_AGE_KEY_FILE`); absent means no sealed file can be opened. Never logged. */
    readonly identity: Secret | undefined
    /** Extra environment for git (author name and email). */
    readonly gitEnv: Readonly<Record<string, string>>
}

/** One key the git author is read from and what the environment declared for it. */
export interface SeedGitValue {
    /** The environment key (`GIT_AUTHOR_NAME`, ...). */
    readonly key: string
    /** The declared value, or undefined when the key is not declared. */
    readonly value: string | undefined
}

/** The raw values the settings of the git layer are read from. */
export interface SeedValues {
    /** `SEED_STANDARD_CACHE`. */
    readonly cache: string | undefined
    /** `SOPS_AGE_KEY` (a mounted `SOPS_AGE_KEY_FILE` is read into it). */
    readonly identity: string | undefined
    /** The git author keys. */
    readonly git: ReadonlyArray<SeedGitValue>
}
