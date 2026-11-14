import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./deliver-video-render.module-definition"
import { DeliverRenderStep } from "./steps/deliver-render.step"

@Module({ providers: [DeliverRenderStep], exports: [DeliverRenderStep] })
/** The application of the video-render delivery job: its step (the delivery service comes from the global compose capability); the queue transport module imports it. */
export class DeliverVideoRenderModule extends ConfigurableModuleClass {}
