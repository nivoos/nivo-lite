import { defineConfigurableModule } from "@starci/nest-kit"
import type { ConnectionPollReadyMessageOptions } from "./connection-poll-ready-message.options"

/** The configurable-module base of the connection-poll-ready-message module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<ConnectionPollReadyMessageOptions>()
