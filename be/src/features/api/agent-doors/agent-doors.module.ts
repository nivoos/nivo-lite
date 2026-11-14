import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./agent-doors.module-definition"
import { ReleaseConversationHandler } from "./application/release-conversation.handler"

@Module({ providers: [ReleaseConversationHandler] })
/** The owner's doors on a customer: the shop's care opt-out and "hand back to the agent" for a held conversation. */
export class AgentDoorsApiModule extends ConfigurableModuleClass {}
