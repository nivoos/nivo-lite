import type { DriverAdapter, SeedGitPort } from "@modules/integrations/seed"
import type { DataSetDeclaration } from "./data-copies.contracts"
import type { DataBackupConfig, DataBackupEnvironment, DataBackupValues } from "./data-copies.options"

/** The environments a backup is kept per. */
const ENVIRONMENTS: ReadonlyArray<DataBackupEnvironment> = ["dev", "prod"]

/** A public age recipient. */
const RECIPIENT_PATTERN = /^age1[0-9a-z]{50,}$/u

/** The key names a backup setting still lacks, or an empty list. */
const missingOf = (
    environment: DataBackupEnvironment | undefined,
    checkout: string | undefined,
    listed: string | undefined,
): ReadonlyArray<string> => [
    ...(environment === undefined ? ["DATA_BACKUP_ENV (dev or prod)"] : []),
    ...(checkout === undefined ? ["DATA_BACKUP_CHECKOUT"] : []),
    ...(listed === undefined ? ["DATA_BACKUP_RECIPIENTS"] : []),
]

/**
 * The backup settings of the raw values: nothing declared, or a required member missing or malformed, answers `enabled: false` with the key
 * names that explain it (never a value); otherwise one environment with its checkout, its public recipients (trimmed) and an optional remote.
 */
export const backupConfigOf = (values: DataBackupValues): DataBackupConfig => {
    const { checkout, recipients: listed } = values
    if (values.environment === undefined && checkout === undefined && listed === undefined) {
        return {
            enabled: false,
            reason: "DATA_BACKUP_ENV, DATA_BACKUP_CHECKOUT and DATA_BACKUP_RECIPIENTS are not declared",
        }
    }
    const environment = ENVIRONMENTS.find((candidate) => candidate === values.environment)
    if (environment === undefined || checkout === undefined || listed === undefined) {
        return { enabled: false, reason: `${missingOf(environment, checkout, listed).join(", ")} missing or invalid` }
    }
    const recipients = listed
        .split(",")
        .map((recipient) => recipient.trim())
        .filter((recipient) => recipient !== "")
    if (recipients.length === 0 || !recipients.every((recipient) => RECIPIENT_PATTERN.test(recipient))) {
        return {
            enabled: false,
            reason: "DATA_BACKUP_RECIPIENTS must hold at least one public age recipient (age1...)",
        }
    }
    return { enabled: true, environment, checkout, remote: values.remote, recipients }
}

/** The driver id of an environment's backup repository. */
export const backupDriverIdOf = (environment: DataBackupEnvironment): string => `nivo-lite-seed-backup-${environment}`

/** The one data set of this deployment (`nivo-lite`): its copy is held by the environment's own backup repository driver (R108). */
export const dataSetOf = (driverId: string): DataSetDeclaration => ({
    id: "nivo-lite",
    purpose: "seed-backup",
    stores: ["database", "storage"],
    drivers: [driverId],
    everyMinutes: 1440,
})

/** The data sets the settings declare: none while the backup is off. */
export const setsOfConfig = (config: DataBackupConfig): ReadonlyArray<DataSetDeclaration> =>
    config.enabled ? [dataSetOf(backupDriverIdOf(config.environment))] : []

/** The git driver of the environment's backup repository: none while the backup is off. */
export const driversOfConfig = (config: DataBackupConfig, git: SeedGitPort): ReadonlyArray<DriverAdapter> =>
    config.enabled
        ? [
              git.backupDriver({
                  id: backupDriverIdOf(config.environment),
                  checkout: config.checkout,
                  remote: config.remote,
              }),
          ]
        : []

/** The slot of a data set at `at`: the number of whole periods of its schedule since the epoch. */
export const backupSlotOf = (set: DataSetDeclaration, at: Date): number =>
    Math.floor(at.getTime() / (set.everyMinutes * 60_000))
