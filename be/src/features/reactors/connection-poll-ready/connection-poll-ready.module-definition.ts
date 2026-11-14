import { defineConfigurableModule } from "@starci/nest-kit"
import type { ConnectionPollReadyReactorOptions } from "./connection-poll-ready.options"

/** The configurable-module base of the connection-poll-ready module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<ConnectionPollReadyReactorOptions>()
