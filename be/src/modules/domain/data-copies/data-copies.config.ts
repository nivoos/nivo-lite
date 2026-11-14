import type { EnvSource } from "@modules/platform/config"
import type { DataBackupConfig } from "./data-copies.options"
import { backupConfigOf } from "./data-backup-config.policy"

/**
 * Reads the backup settings: `DATA_BACKUP_ENV` (`dev` | `prod`), `DATA_BACKUP_CHECKOUT`, `DATA_BACKUP_RECIPIENTS` (comma list of public age
 * keys) and the optional `DATA_BACKUP_REMOTE`. Nothing declared, or a required member missing or malformed, answers `enabled: false` with
 * the key names that explain it (never a value). The identity and the git author come from the seed integration settings.
 */
export const parseDataBackupConfig = (env: EnvSource): DataBackupConfig =>
    backupConfigOf({
        environment: env.optional("DATA_BACKUP_ENV"),
        checkout: env.optional("DATA_BACKUP_CHECKOUT"),
        recipients: env.optional("DATA_BACKUP_RECIPIENTS"),
        remote: env.optional("DATA_BACKUP_REMOTE"),
    })
