import { defineConfigurableModule } from "@starci/nest-kit"
import type { DeliverRecordEventOptions } from "./deliver-record-event.options"

/** The configurable-module base of the record-event job module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<DeliverRecordEventOptions>()
