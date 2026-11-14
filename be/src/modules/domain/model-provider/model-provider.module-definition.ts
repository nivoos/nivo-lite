import { defineCapabilityModule } from "@starci/nest-kit"
import type { ModelProviderOptions } from "./model-provider.options"

export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<ModelProviderOptions>()
