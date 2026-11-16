import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./data-verify.module-definition"
import { DataVerifyStep } from "./steps/data-verify.step"

@Module({ providers: [DataVerifyStep], exports: [DataVerifyStep] })
/** The application of the data-verify job: its step, which calls the data-copies domain. */
export class DataVerifyModule extends ConfigurableModuleClass {}
