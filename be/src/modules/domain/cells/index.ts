// Slice 0: contracts, ports, injectors, errors, messages and the module skeleton.
export { CellsModule } from "./cells.module"
export type { CellsOptions } from "./cells.options"
export type {
    CauseFacts,
    CellDefinitionView,
    CellExample,
    CellFile,
    CoreSetConfig,
    CellGraphDocument,
    CellGraphFile,
    CellGraphStep,
    CellGraphView,
    CellKind,
    CellListFilter,
    CellOutcome,
    CellPackageFile,
    CellPackageOrigin,
    CellRef,
    CellSemantics,
    CellSourceInput,
    CellSourceView,
    CellVerdict,
    ConfirmArg,
    ConfirmBy,
    ConfirmRead,
    ExecuteRequest,
    ExecuteResult,
    ExecuteScope,
    ExprTruth,
    GraphRef,
    GraphVarDeclaration,
    JsonObject,
    JsonSchema,
    JsonValue,
    LocalizedText,
    MeteredBy,
    RecordedCall,
    RefOrValue,
    ReviewState,
    RunStateRegion,
    RunVariable,
    RunnerFacts,
    RunnerInbound,
    RunnerLimits,
    RunnerOutbound,
    RunnerRunRequest,
    RunnerRunResult,
    SeedReceiptInput,
    SeedReport,
    StoredExpr,
    StoredRef,
    ToolAnswer,
    UsageFigures,
    ValidatedCell,
    ValidatedGraph,
} from "./cells.contracts"
export type { CellDefinitionsWriter } from "./cell-definitions-writer.port"
export type { CellExecutor } from "./cell-executor.port"
export type { CellLedger } from "./cell-ledger.port"
export type { CellMeter } from "./cell-meter.port"
export type { CellReader } from "./cell-reader.port"
export type { CellRunner, RunnerDoor } from "./cell-runner.port"
export type { CellToolDoor } from "./cell-tool-door.port"
export {
    CELL_DEFINITIONS_WRITER,
    CELL_EXECUTOR,
    CELL_LEDGER,
    CELL_METER,
    CELL_READER,
    CELL_RUNNER,
    CELL_TOOL_DOOR,
    InjectCellDefinitionsWriter,
    InjectCellExecutor,
    InjectCellLedger,
    InjectCellMeter,
    InjectCellReader,
    InjectCellRunner,
    InjectCellToolDoor,
} from "./cells.decorators"
export { CELLS_ERROR_KINDS, CellsError, CellsErrorCode } from "./errors/cells.error"
export { CELLS_MESSAGES } from "./messages/cells.messages"
// Each slice adds ONLY its own block below, under its own heading, and nothing else in this file.
// S1 (storage and reader):
export { CellDefinitionsService } from "./cell-definitions.service"
export { canonicalJsonOf, definitionHashOf, documentHashOf, graphRefTextOf, refTextOf, sha256Of } from "./cell-hash.policy"
export type { DefinitionContent } from "./cell-hash.policy"
export { CELL_CACHE_LIMITS, CellReaderService } from "./cell-reader.service"
export {
    CellDefinitionEntity,
    CellGraphEntity,
    CellPackageEntity,
    CellSeedReceiptEntity,
    CellSourceEntity,
    cellsEntities,
} from "./persistence/entities"
// S2 (seed):
// S3 (runner):
// S4 (executor, adapters, module wiring):
// S5 (test kit):
