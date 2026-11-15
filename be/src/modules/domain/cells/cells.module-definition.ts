import { defineCapabilityModule } from "@starci/nest-kit"
import { CELLS_OPTIONS } from "./cells.decorators"
import type { CellsOptions } from "./cells.options"

export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<CellsOptions>({
    optionsInjectionToken: CELLS_OPTIONS,
})
