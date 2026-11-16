import { defineConfigurableModule } from "@starci/nest-kit"
import type { DeliverRecordEventQueueOptions } from "./deliver-record-event-queue.options"

/** The configurable-module base of the record-event-queue module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<DeliverRecordEventQueueOptions>()
