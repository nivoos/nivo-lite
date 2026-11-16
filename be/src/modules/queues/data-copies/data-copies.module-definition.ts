import { defineConfigurableModule } from "@starci/nest-kit"
import type { DataCopiesQueueOptions } from "./data-copies.options"

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<DataCopiesQueueOptions>()
