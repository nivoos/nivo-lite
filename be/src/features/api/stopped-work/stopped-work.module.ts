import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./stopped-work.module-definition"
import { CloseStoppedWorkHandler } from "./application/close-stopped-work.handler"
import { ListStoppedEventsHandler } from "./application/list-stopped-events.handler"
import { ListStoppedWorkHandler } from "./application/list-stopped-work.handler"
import { RequeueStoppedEventHandler } from "./application/requeue-stopped-event.handler"
import { ResumeStoppedWorkHandler } from "./application/resume-stopped-work.handler"

@Module({
    providers: [
        ListStoppedWorkHandler,
        ResumeStoppedWorkHandler,
        CloseStoppedWorkHandler,
        ListStoppedEventsHandler,
        RequeueStoppedEventHandler,
    ],
})
/** The stopped-work feature: the handlers of its application (stopped jobs and buried events). */
export class StoppedWorkApiModule extends ConfigurableModuleClass {}
