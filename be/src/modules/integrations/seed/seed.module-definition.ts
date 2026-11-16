import { defineCapabilityModule } from "@starci/nest-kit"
import type { DataSeedOptions } from "./seed.options"

/** The configurable-module base of the seed integration. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineCapabilityModule<DataSeedOptions>()
