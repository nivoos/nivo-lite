import { defineCapabilityModule } from "@starci/nest-kit"
import { EFFECTS_OPTIONS } from "./effects.decorators"
import type { EffectsOptions } from "./effects.options"

export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<EffectsOptions>({
    optionsInjectionToken: EFFECTS_OPTIONS,
})
