import { defineConfigurableModule } from "@starci/nest-kit"
import type { SeedSetOptions } from "./seed-set.options"

/** The configurable-module base of the seed-set module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<SeedSetOptions>()
