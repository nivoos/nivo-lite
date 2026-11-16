import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./process-public-api.module-definition"
import { ProcessPublicApiStep } from "./steps/process-public-api.step"
import { SendPublicMessageStep } from "./steps/send-public-message.step"

@Module({ providers: [ProcessPublicApiStep, SendPublicMessageStep], exports: [ProcessPublicApiStep, SendPublicMessageStep] })
/** Processes one public API request in the transaction that holds its worker fence, and sends the reply it owes as its own job. */
export class ProcessPublicApiJobModule extends ConfigurableModuleClass {}
