import { defineConfigurableModule } from "@starci/nest-kit"
import type { RefreshZaloConnectionQueueOptions } from "./refresh-zalo-connection-queue.options"

/** The configurable-module base of the refresh-zalo-connection-queue module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<RefreshZaloConnectionQueueOptions>()
