import { defineConfigurableModule } from "@starci/nest-kit"
import type { RouteTeamChatMessageQueueOptions } from "./route-team-chat-message-queue.options"

/** The configurable-module base of the route-team-chat-message-queue module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<RouteTeamChatMessageQueueOptions>()
