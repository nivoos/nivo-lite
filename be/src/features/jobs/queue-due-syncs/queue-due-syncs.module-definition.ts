import { defineConfigurableModule } from "@starci/nest-kit"
import type { QueueDueSyncsOptions } from "./queue-due-syncs.options"

/** The configurable-module base of the queue-due-syncs module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<QueueDueSyncsOptions>()
