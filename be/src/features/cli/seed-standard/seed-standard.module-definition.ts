import { defineConfigurableModule } from "@starci/nest-kit"
import type { SeedStandardOptions } from "./seed-standard.options"

/** The configurable-module base of the seed-standard module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<SeedStandardOptions>()
