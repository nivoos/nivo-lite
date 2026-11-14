import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { CellDefinitionsWriter } from "./cell-definitions-writer.port"
import type { CellExecutor } from "./cell-executor.port"
import type { CellLedger } from "./cell-ledger.port"
import type { CellMeter } from "./cell-meter.port"
import type { CellReader } from "./cell-reader.port"
import type { CellRunner } from "./cell-runner.port"
import type { CellToolDoor } from "./cell-tool-door.port"

/** Token of the cell reader. */
export const CELL_READER: unique symbol = Symbol("domain.cells.reader")

/** Injects the cell reader. Parameter type: CellReader. */
export const InjectCellReader = (): TypedParameterDecorator<CellReader> => injector<CellReader>(CELL_READER)

/** Token of the cell definitions writer. */
export const CELL_DEFINITIONS_WRITER: unique symbol = Symbol("domain.cells.definitions-writer")

/** Injects the cell definitions writer. Parameter type: CellDefinitionsWriter. */
export const InjectCellDefinitionsWriter = (): TypedParameterDecorator<CellDefinitionsWriter> =>
    injector<CellDefinitionsWriter>(CELL_DEFINITIONS_WRITER)

/** Token of the isolated runner. */
export const CELL_RUNNER: unique symbol = Symbol("domain.cells.runner")

/** Injects the isolated runner. Parameter type: CellRunner. */
export const InjectCellRunner = (): TypedParameterDecorator<CellRunner> => injector<CellRunner>(CELL_RUNNER)

/** Token of the intent ledger. */
export const CELL_LEDGER: unique symbol = Symbol("domain.cells.ledger")

/** Injects the intent ledger. Parameter type: CellLedger. */
export const InjectCellLedger = (): TypedParameterDecorator<CellLedger> => injector<CellLedger>(CELL_LEDGER)

/** Token of the credit meter. */
export const CELL_METER: unique symbol = Symbol("domain.cells.meter")

/** Injects the credit meter. Parameter type: CellMeter. */
export const InjectCellMeter = (): TypedParameterDecorator<CellMeter> => injector<CellMeter>(CELL_METER)

/** Token of the tool door. */
export const CELL_TOOL_DOOR: unique symbol = Symbol("domain.cells.tool-door")

/** Injects the tool door. Parameter type: CellToolDoor. */
export const InjectCellToolDoor = (): TypedParameterDecorator<CellToolDoor> => injector<CellToolDoor>(CELL_TOOL_DOOR)

/** Token of the executor. */
export const CELL_EXECUTOR: unique symbol = Symbol("domain.cells.executor")

/** Injects the executor. Parameter type: CellExecutor. */
export const InjectCellExecutor = (): TypedParameterDecorator<CellExecutor> => injector<CellExecutor>(CELL_EXECUTOR)
