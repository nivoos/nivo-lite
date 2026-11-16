import { defineConfigurableModule } from "@starci/nest-kit"
import type { RouteTeamChatMessageOptions } from "./route-team-chat-message.options"

/** The configurable-module base of the route-team-chat-message job module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<RouteTeamChatMessageOptions>()
