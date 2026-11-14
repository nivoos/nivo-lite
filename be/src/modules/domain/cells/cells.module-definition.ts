import { defineCapabilityModule } from "@starci/nest-kit"
import type { CellsOptions } from "./cells.options"

export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<CellsOptions>()
