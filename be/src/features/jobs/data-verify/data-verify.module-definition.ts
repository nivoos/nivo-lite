import { defineConfigurableModule } from "@starci/nest-kit"
import type { DataVerifyOptions } from "./data-verify.options"

/** The configurable-module base of the data-verify module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<DataVerifyOptions>()
