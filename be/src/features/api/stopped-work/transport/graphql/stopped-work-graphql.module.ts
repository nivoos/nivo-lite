import { Module } from "@nestjs/common"
import { StoppedWorkApiModule } from "../../stopped-work.module"
import { CloseStoppedWorkResolver } from "./close-stopped-work.resolver"
import { ListStoppedEventsResolver } from "./list-stopped-events.resolver"
import { ListStoppedWorkResolver } from "./list-stopped-work.resolver"
import { RequeueStoppedEventResolver } from "./requeue-stopped-event.resolver"
import { ResumeStoppedWorkResolver } from "./resume-stopped-work.resolver"
import { ConfigurableModuleClass } from "./stopped-work-graphql.module-definition"

@Module({
    imports: [StoppedWorkApiModule.register({})],
    providers: [
        ListStoppedWorkResolver,
        ResumeStoppedWorkResolver,
        CloseStoppedWorkResolver,
        ListStoppedEventsResolver,
        RequeueStoppedEventResolver,
    ],
})
/** The GraphQL transport of the stopped-work feature. */
export class StoppedWorkGraphqlModule extends ConfigurableModuleClass {}
