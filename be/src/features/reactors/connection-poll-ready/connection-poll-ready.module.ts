import { Module } from "@nestjs/common"
import { StartConnectionPollHandler } from "./application/start-connection-poll.handler"
import { ConfigurableModuleClass } from "./connection-poll-ready.module-definition"

@Module({ providers: [StartConnectionPollHandler] })
/** The connection-poll-ready reactor: the handler its consumer dispatches to. */
export class ConnectionPollReadyReactorModule extends ConfigurableModuleClass {}
