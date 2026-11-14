import { defineConfigurableModule } from "@starci/nest-kit"
import type { DataBackupQueueOptions } from "./data-backup-queue.options"

/** The configurable-module base of the data-backup-queue module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<DataBackupQueueOptions>()
