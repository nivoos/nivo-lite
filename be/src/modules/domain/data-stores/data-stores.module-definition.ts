import { defineCapabilityModule } from "@starci/nest-kit"
import type { DataStoresOptions } from "./data-stores.options"

/** The configurable-module base of the data-stores capability. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineCapabilityModule<DataStoresOptions>()
