import { defineConfigurableModule } from "@starci/nest-kit"
import type { DataStoreCliOptions } from "./data-store.options"

/** The configurable-module base of the data-store cli module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<DataStoreCliOptions>()
