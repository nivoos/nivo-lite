import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./queue-due-syncs.module-definition"
import { QueueDueSyncsStep } from "./steps/queue-due-syncs.step"

@Module({ providers: [QueueDueSyncsStep], exports: [QueueDueSyncsStep] })
/** The application of the queue-due-syncs job: its step; the queue transport module imports it. */
export class QueueDueSyncsModule extends ConfigurableModuleClass {}
