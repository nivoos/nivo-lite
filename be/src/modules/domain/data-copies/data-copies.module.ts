import { Module, type DynamicModule } from "@nestjs/common"
import { SEED_GIT, memorySpool, type SeedGitPort } from "@modules/integrations/seed"
import { DataCopiesQueueModule } from "@modules/queues/data-copies"
import { DataBackupDueService } from "./data-backup-due.service"
import { DataBackupNoticeService } from "./data-backup-notice.service"
import { DataBackupService } from "./data-backup.service"
import { DataVerifyService } from "./data-verify.service"
import {
    DATA_BACKUP_CONFIG,
    DATA_DRIVERS,
    DATA_OPEN_CONTEXT,
    DATA_RECIPIENTS,
    DATA_SET_LIST,
    DATA_SPOOL,
    type DataSpools,
} from "./data-copies.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./data-copies.module-definition"
import { driversOfConfig, setsOfConfig } from "./data-backup-config.policy"

/** The spool of an export: in memory until the harness spools to a private scratch directory (a real export of a large store must not be held in memory). */
const memorySpools: DataSpools = { make: () => memorySpool() }

@Module({})
/**
 * The data copy jobs' domain: the backup of the declared data set, its tick and the daily verify. Bound for the CURRENT environment only (owner
 * R108): the git driver `nivo-lite-seed-backup-<env>` (checkout outside every app tree, optional remote), the environment's PUBLIC recipients,
 * its identity for the verify's open, and the declared data set. With no settings (or an incomplete one) the set list is EMPTY: the ticks
 * answer a no-op and the reason is logged once. The data stores come from the data-stores capability.
 */
export class DataCopiesModule extends ConfigurableModuleClass {
    /** Registers the capability once in the API app with the backup settings parsed at the composition root. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        const config = options.backup
        return {
            ...base,
            imports: [...(base.imports ?? []), DataCopiesQueueModule.register({})],
            providers: [
                ...(base.providers ?? []),
                DataBackupService,
                DataBackupDueService,
                DataVerifyService,
                DataBackupNoticeService,
                { provide: DATA_BACKUP_CONFIG, useValue: config },
                { provide: DATA_SPOOL, useValue: memorySpools },
                { provide: DATA_SET_LIST, useValue: setsOfConfig(config) },
                { provide: DATA_RECIPIENTS, useValue: config.enabled ? config.recipients : [] },
                {
                    provide: DATA_DRIVERS,
                    inject: [SEED_GIT],
                    useFactory: (git: SeedGitPort) => driversOfConfig(config, git),
                },
                { provide: DATA_OPEN_CONTEXT, inject: [SEED_GIT], useFactory: (git: SeedGitPort) => git.openContext() },
            ],
            exports: [DataBackupService, DataBackupDueService, DataVerifyService],
        }
    }
}
