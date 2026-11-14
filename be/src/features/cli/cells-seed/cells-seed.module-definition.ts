import { defineConfigurableModule } from "@starci/nest-kit"
import type { CellsSeedOptions } from "./cells-seed.options"

/** The configurable-module base of the cells-seed module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<CellsSeedOptions>()
