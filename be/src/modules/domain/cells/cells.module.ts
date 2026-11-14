import { Module, type DynamicModule, type Provider } from "@nestjs/common"
import { CellDefinitionsService } from "./cell-definitions.service"
import type { CellDefinitionsWriter } from "./cell-definitions-writer.port"
import { CELLS_RUNNER_LIMITS, CellExecutorService } from "./cell-executor.service"
import { CellExpressionPolicy } from "./cell-expression.policy"
import { CellJsonSchemaPolicy } from "./cell-json-schema.policy"
import type { CellLedger } from "./cell-ledger.port"
import type { CellMeter } from "./cell-meter.port"
import type { CellReader } from "./cell-reader.port"
import { CellReaderService } from "./cell-reader.service"
import type { CellRunner } from "./cell-runner.port"
import type { CellToolDoor } from "./cell-tool-door.port"
import {
    CELL_DEFINITIONS_WRITER,
    CELL_EXECUTOR,
    CELL_LEDGER,
    CELL_METER,
    CELL_READER,
    CELL_RUNNER,
    CELL_TOOL_DOOR,
} from "./cells.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./cells.module-definition"
import { MemoryCellLedgerClient } from "./memory-cell-ledger.client"
import { MemoryCellMeterClient } from "./memory-cell-meter.client"

/**
 * Ports a spec (or a later migration step) binds to something else than the phase-0 default, by value: a double of the kit, or a V1
 * adapter. A port left out keeps its default: reader and writer are the database services, ledger and meter the in-memory adapters.
 * The runner and the tool door have no default here: the runner client binds when slice S3 lands, the tool door adapter comes at M5.
 */
export interface CellsPortOverrides {
    readonly reader?: CellReader
    readonly writer?: CellDefinitionsWriter
    readonly runner?: CellRunner
    readonly ledger?: CellLedger
    readonly meter?: CellMeter
    readonly toolDoor?: CellToolDoor
}

/** One port bound to a value when overridden, else to its default class. */
const bound = <Port extends object>(token: symbol, override: Port | undefined, fallback: (new (...args: never[]) => Port) | null): Provider | null => {
    if (override !== undefined) return { provide: token, useValue: override }
    return fallback === null ? null : { provide: token, useClass: fallback }
}

@Module({})
/**
 * The cells capability (CELLS-PLAN): the generic building blocks of NIVO V2, stored in the database and run in an isolated runner.
 * Binds each port token of `cells.decorators.ts` to its provider and exports the executor and the reader. No file outside the cells
 * folders imports it until a migration step says so.
 */
export class CellsModule extends ConfigurableModuleClass {
    /** Registers the capability with the options the app read once, and optionally other bindings for some ports. */
    static register(options: typeof OPTIONS_TYPE, overrides: CellsPortOverrides = {}): DynamicModule {
        const base = super.register(options)
        const ports = [
            bound(CELL_READER, overrides.reader, CellReaderService),
            bound(CELL_DEFINITIONS_WRITER, overrides.writer, CellDefinitionsService),
            bound(CELL_RUNNER, overrides.runner, null),
            bound(CELL_LEDGER, overrides.ledger, MemoryCellLedgerClient),
            bound(CELL_METER, overrides.meter, MemoryCellMeterClient),
            bound(CELL_TOOL_DOOR, overrides.toolDoor, null),
        ].filter((provider): provider is Provider => provider !== null)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                ...ports,
                { provide: CELLS_RUNNER_LIMITS, useValue: options.runnerLimits },
                CellExpressionPolicy,
                CellJsonSchemaPolicy,
                { provide: CELL_EXECUTOR, useClass: CellExecutorService },
            ],
            exports: [CELL_EXECUTOR, CELL_READER, CELL_DEFINITIONS_WRITER, CELL_LEDGER, CELL_METER, CellExpressionPolicy],
        }
    }
}
