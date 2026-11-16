import { Module, type DynamicModule } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { EFFECTS, EFFECTS_MANAGERS } from "./effects.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./effects.module-definition"
import { EffectsService } from "./effects.service"

@Module({})
/** The one door of the acts outside the database: the intent-before-act ledger. Register it once per app that runs jobs, with the connection that holds `public.effect_ledger`. */
export class EffectsModule extends ConfigurableModuleClass {
    /** Registers the capability once per app. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                { provide: EFFECTS_MANAGERS, useFactory: (manager: EntityManager) => [manager], inject: [options.connection] },
                EffectsService,
                { provide: EFFECTS, useExisting: EffectsService },
            ],
            exports: [EFFECTS],
        }
    }
}
