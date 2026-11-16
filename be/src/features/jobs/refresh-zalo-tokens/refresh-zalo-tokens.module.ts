import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./refresh-zalo-tokens.module-definition"
import { FanOutRefreshStep } from "./steps/fan-out-refresh.step"

@Module({ providers: [FanOutRefreshStep], exports: [FanOutRefreshStep] })
/** The application of the refresh-zalo-tokens job (the tick): its step; the queue transport module imports it. */
export class RefreshZaloTokensModule extends ConfigurableModuleClass {}
