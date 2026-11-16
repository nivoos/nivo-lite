import { defineConfigurableModule } from "@starci/nest-kit"
import type { DeliverWebsiteFormQueueOptions } from "./deliver-website-form-queue.options"

/** The configurable-module base of the website-form-queue module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<DeliverWebsiteFormQueueOptions>()
