import { defineConfigurableModule } from "@starci/nest-kit"
import type { QueueDueSyncsQueueOptions } from "./queue-due-syncs-queue.options"

/** The configurable-module base of the queue-due-syncs-queue module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<QueueDueSyncsQueueOptions>()
