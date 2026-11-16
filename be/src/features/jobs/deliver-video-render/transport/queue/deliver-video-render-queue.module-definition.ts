import { defineConfigurableModule } from "@starci/nest-kit"
import type { DeliverVideoRenderQueueOptions } from "./deliver-video-render-queue.options"

/** The configurable-module base of the video-render delivery queue module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<DeliverVideoRenderQueueOptions>()
