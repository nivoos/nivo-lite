import { Module, type DynamicModule, type Provider } from "@nestjs/common"
import { CellDefinitionsService } from "./cell-definitions.service"
import type { CellDefinitionsWriter } from "./cell-definitions-writer.port"
import { CellExecutorService } from "./cell-executor.service"
import { CellExpressionPolicy } from "./cell-expression.policy"
import { CellJsonSchemaPolicy } from "./cell-json-schema.policy"
import type { CellLedger } from "./cell-ledger.port"
import type { CellMeter } from "./cell-meter.port"
import type { CellReader } from "./cell-reader.port"
import { CellReaderService } from "./cell-reader.service"
import { CellRunnerClient, readDirsOf } from "./cell-runner.client"
import type { CellRunner } from "./cell-runner.port"
import { CellSeedService } from "./cell-seed.service"
import type { CellToolDoor } from "./cell-tool-door.port"
import { CellValidationService } from "./cell-validation.service"
import {
    CELL_DEFINITIONS_WRITER,
    CELL_EXECUTOR,
    CELL_LEDGER,
    CELL_METER,
    CELL_READER,
    CELL_RUNNER,
    CELL_TOOL_DOOR,
    CELLS_OPTIONS,
} from "./cells.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./cells.module-definition"
import type { CellsOptions } from "./cells.options"
import { CellsError, CellsErrorCode } from "./errors/cells.error"
import { MemoryCellLedgerClient } from "./memory-cell-ledger.client"
import { MemoryCellMeterClient } from "./memory-cell-meter.client"

/**
 * Ports bound to something else than their default, by value: a double of the kit, or a V1 adapter at a later migration step. A port left out
 * keeps its default: reader and writer are the database services, the runner is the isolated runner client built from the options, ledger and
 * meter are the in-memory adapters of phase 0. The tool door has NO default (phase 0 has no real door): a module that executes cells must be given one.
 */
export interface CellsPortOverrides {
    readonly reader?: CellReader
    readonly writer?: CellDefinitionsWriter
    readonly runner?: CellRunner
    readonly ledger?: CellLedger
    readonly meter?: CellMeter
    readonly toolDoor?: CellToolDoor
}

/** One port bound to its override by value, else to its default class. */
const bound = <Port extends object>(
    token: symbol,
    override: Port | undefined,
    fallback: new (...args: never[]) => Port,
): Provider =>
    override === undefined ? { provide: token, useClass: fallback } : { provide: token, useValue: override }

/** The isolated runner client the options describe: their limits and pool, their entry, and the read set of that entry. */
const runnerOf = (options: CellsOptions): CellRunnerClient =>
    new CellRunnerClient({
        limits: options.runnerLimits,
        poolSize: options.runnerPoolSize,
        entry: options.runnerEntry,
        readDirs: readDirsOf(options.runnerEntry),
    })

@Module({})
/**
 * The cells capability (CELLS-PLAN): the generic building blocks of NIVO V2, stored in the database and run in an isolated runner. Binds every port
 * token of `cells.decorators.ts` to its real provider (each replaceable by `overrides`), the two policies, the validation and the seed. A module
 * that executes cells (the default) also binds the executor and needs a tool door; `seedOnly` (the cli's `cells-seed`) binds no executor and no door.
 * No file outside the cells folders and the cli composition root imports it until a migration step says so.
 */
export class CellsModule extends ConfigurableModuleClass {
    /** Registers the capability with the options the app read once, and optionally other bindings for some ports. */
    static register(options: typeof OPTIONS_TYPE, overrides: CellsPortOverrides = {}): DynamicModule {
        const executes = options.seedOnly !== true
        if (executes && overrides.toolDoor === undefined) {
            throw new CellsError({ code: CellsErrorCode.ToolDoorMissing, params: { module: "CellsModule" } })
        }
        const base = super.register(options)
        const seeding: ReadonlyArray<Provider> = [
            bound(CELL_READER, overrides.reader, CellReaderService),
            bound(CELL_DEFINITIONS_WRITER, overrides.writer, CellDefinitionsService),
            overrides.runner === undefined
                ? { provide: CELL_RUNNER, useFactory: runnerOf, inject: [CELLS_OPTIONS] }
                : { provide: CELL_RUNNER, useValue: overrides.runner },
            CellJsonSchemaPolicy,
            CellExpressionPolicy,
            CellValidationService,
            CellSeedService,
        ]
        const executing: ReadonlyArray<Provider> =
            overrides.toolDoor !== undefined && executes
                ? [
                      bound(CELL_LEDGER, overrides.ledger, MemoryCellLedgerClient),
                      bound(CELL_METER, overrides.meter, MemoryCellMeterClient),
                      { provide: CELL_TOOL_DOOR, useValue: overrides.toolDoor },
                      { provide: CELL_EXECUTOR, useClass: CellExecutorService },
                  ]
                : []
        const seedExports = [
            CELL_READER,
            CELL_DEFINITIONS_WRITER,
            CELL_RUNNER,
            CellJsonSchemaPolicy,
            CellExpressionPolicy,
            CellValidationService,
            CellSeedService,
        ]
        return {
            ...base,
            providers: [...(base.providers ?? []), ...seeding, ...executing],
            exports: [...seedExports, ...(executes ? [CELL_EXECUTOR, CELL_LEDGER, CELL_METER] : [])],
        }
    }
}
