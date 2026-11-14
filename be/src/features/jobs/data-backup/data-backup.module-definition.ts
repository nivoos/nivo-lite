import { defineConfigurableModule } from "@starci/nest-kit"
import type { DataBackupOptions } from "./data-backup.options"

/** The configurable-module base of the data-backup module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<DataBackupOptions>()
