import { defineConfigurableModule } from "@starci/nest-kit"
import type { JobProgressSseOptions } from "./job-progress-sse.options"

/** The configurable-module base of the job-progress-sse module. */
export const { ConfigurableModuleClass } = defineConfigurableModule<JobProgressSseOptions>()
