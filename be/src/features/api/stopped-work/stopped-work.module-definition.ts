import { defineConfigurableModule } from "@starci/nest-kit"
import type { StoppedWorkApiOptions } from "./stopped-work.options"

/** The configurable-module base of the stopped-work module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<StoppedWorkApiOptions>()
