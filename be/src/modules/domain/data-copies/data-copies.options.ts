/** The environments a backup is kept per (owner R108): each environment has its own `nivo-lite-seed-backup-<env>` repository. */
export type DataBackupEnvironment = "dev" | "prod"

/** The settings of a scheduled backup that is on. */
export interface DataBackupEnabled {
    /** Marks the backup as on. */
    readonly enabled: true
    /** The environment this deployment is; dev never opens or seals for prod. */
    readonly environment: DataBackupEnvironment
    /** The working copy of the backup repository: a directory outside every code repository. */
    readonly checkout: string
    /** The backup repository's remote (never a URL holding a credential), or undefined for a local copy only. */
    readonly remote: string | undefined
    /** The PUBLIC age recipients of THIS environment's rule (`age1...`); a write is sealed to them only. */
    readonly recipients: ReadonlyArray<string>
}

/** A scheduled backup that is off, with the reason: an absent setting is a no-op, never a boot failure. */
export interface DataBackupDisabled {
    /** Marks the backup as off. */
    readonly enabled: false
    /** The key names that explain it (never a value). */
    readonly reason: string
}

/** The settings of the scheduled backup, or why there is none. */
export type DataBackupConfig = DataBackupEnabled | DataBackupDisabled

/** The raw values the backup settings are read from (each `undefined` when its key is not declared). */
export interface DataBackupValues {
    /** `DATA_BACKUP_ENV`. */
    readonly environment: string | undefined
    /** `DATA_BACKUP_CHECKOUT`. */
    readonly checkout: string | undefined
    /** `DATA_BACKUP_RECIPIENTS`: a comma list. */
    readonly recipients: string | undefined
    /** `DATA_BACKUP_REMOTE`. */
    readonly remote: string | undefined
}

/** The settings of the data copy jobs. */
export interface DataCopiesOptions {
    /** The scheduled backup of this environment, or why there is none. */
    readonly backup: DataBackupConfig
}
