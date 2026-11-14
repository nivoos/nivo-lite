import { defineConfigurableModule } from "@starci/nest-kit"
import type { StoppedWorkGraphqlOptions } from "./stopped-work-graphql.options"

/** The configurable-module base of the stopped-work-graphql module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<StoppedWorkGraphqlOptions>()
