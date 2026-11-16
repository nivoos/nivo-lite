import { defineConfigurableModule } from "@starci/nest-kit"
import type { DeliverVideoRenderOptions } from "./deliver-video-render.options"

/** The configurable-module base of the video-render delivery job module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<DeliverVideoRenderOptions>()
