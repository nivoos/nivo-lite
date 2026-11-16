import { Module, type DynamicModule } from "@nestjs/common"
import { AI_GENERATIONS_USAGE } from "./ai-generations.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./ai-generations.module-definition"
import { GenerationRunnerService } from "./generation-runner.service"
import { GenerationsService } from "./generations.service"
import { GuideService } from "./guide.service"

@Module({})
/** Every text the app writes outside customer chat: a queued row, a job that runs it on the AI endpoint, and the caller looking at the row. */
export class AiGenerationsModule extends ConfigurableModuleClass {
    /** Registers the capability once; the usage port is bound to the class the options name. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                { provide: AI_GENERATIONS_USAGE, useClass: options.usage },
                GenerationsService,
                GenerationRunnerService,
                GuideService,
            ],
            exports: [
                GenerationsService,
                GenerationRunnerService,
                GuideService,
            ],
        }
    }
}
