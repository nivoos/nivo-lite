import { defineConfigurableModule } from "@starci/nest-kit"
import type { RefreshZaloConnectionOptions } from "./refresh-zalo-connection.options"

/** The configurable-module base of the refresh-zalo-connection module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<RefreshZaloConnectionOptions>()
