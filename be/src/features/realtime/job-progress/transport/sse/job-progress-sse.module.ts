import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./job-progress-sse.module-definition"
import { JobProgressController } from "./job-progress.controller"

@Module({ controllers: [JobProgressController] })
/** The server-sent-events transport of the job-progress channel: the one generic door of every job's progress, per workspace member. */
export class JobProgressSseModule extends ConfigurableModuleClass {}
