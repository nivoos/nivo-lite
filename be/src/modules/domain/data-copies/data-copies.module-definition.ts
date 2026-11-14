import { defineCapabilityModule } from "@starci/nest-kit"
import type { DataCopiesOptions } from "./data-copies.options"

/** The configurable-module base of the data-copies capability. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineCapabilityModule<DataCopiesOptions>()
