import { defineCapabilityModule } from "@starci/nest-kit"
import type { SeedStandardGitOptions } from "./seed-standard-git.options"

/** The configurable-module base of the seed-standard-git capability. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineCapabilityModule<SeedStandardGitOptions>()
