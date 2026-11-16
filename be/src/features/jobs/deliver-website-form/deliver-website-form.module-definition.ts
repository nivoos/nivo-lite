import { defineConfigurableModule } from "@starci/nest-kit"
import type { DeliverWebsiteFormOptions } from "./deliver-website-form.options"

/** The configurable-module base of the website-form job module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<DeliverWebsiteFormOptions>()
