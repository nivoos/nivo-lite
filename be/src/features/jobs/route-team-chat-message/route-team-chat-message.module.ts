import { Module } from "@nestjs/common"
import { TeamChatRouteService } from "@modules/domain/team-chat"
import { ConfigurableModuleClass } from "./route-team-chat-message.module-definition"
import { RouteMessageStep } from "./steps/route-message.step"

@Module({ providers: [TeamChatRouteService, RouteMessageStep], exports: [RouteMessageStep] })
/** The application of the route job: the route of a stored message (api only) and its step; the queue transport module imports it. */
export class RouteTeamChatMessageModule extends ConfigurableModuleClass {}
