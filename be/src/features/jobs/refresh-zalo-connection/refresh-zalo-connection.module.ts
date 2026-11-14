import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./refresh-zalo-connection.module-definition"
import { RenewConnectionStep } from "./steps/renew-connection.step"

@Module({ providers: [RenewConnectionStep], exports: [RenewConnectionStep] })
/** The application of the refresh-zalo-connection job: its step; the queue transport module imports it. */
export class RefreshZaloConnectionModule extends ConfigurableModuleClass {}
