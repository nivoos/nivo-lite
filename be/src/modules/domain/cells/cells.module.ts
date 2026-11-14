import { Module, type DynamicModule } from "@nestjs/common"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./cells.module-definition"

@Module({})
/**
 * The cells capability (CELLS-PLAN): the generic building blocks of NIVO V2, stored in the database and run in an isolated runner.
 * SKELETON of slice 0: it registers no provider yet. Slice S4 fills `providers` and `exports` in this one place, binding each port token
 * of `cells.decorators.ts` to the class that implements it (S1 reader and writer, S3 runner client, S4 executor and memory adapters).
 * No file outside the cells folders imports it until a migration step says so.
 */
export class CellsModule extends ConfigurableModuleClass {
    /** Registers the capability with the options the app read once. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [...(base.providers ?? [])],
            exports: [],
        }
    }
}
