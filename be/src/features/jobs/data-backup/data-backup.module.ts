import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./data-backup.module-definition"
import { BackupDueStep } from "./steps/backup-due.step"
import { DataBackupStep } from "./steps/data-backup.step"

@Module({ providers: [DataBackupStep, BackupDueStep], exports: [DataBackupStep, BackupDueStep] })
/** The application of the data-backup jobs: the backup of one data set and the tick that queues it; their steps call the data-copies domain. */
export class DataBackupModule extends ConfigurableModuleClass {}
