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
    RunnerCapability,
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
    RunFacts,
    ToolAnswer,
    ToolCallKey,
    ToolUsage,
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
    CELLS_OPTIONS,
    InjectCellDefinitionsWriter,
    InjectCellExecutor,
    InjectCellLedger,
    InjectCellMeter,
    InjectCellReader,
    InjectCellRunner,
    InjectCellToolDoor,
    InjectCellsOptions,
} from "./cells.decorators"
export { CELLS_ERROR_KINDS, CellsError, CellsErrorCode } from "./errors/cells.error"
export { CELLS_MESSAGES } from "./messages/cells.messages"
// Each slice adds ONLY its own block below, under its own heading, and nothing else in this file.
// S1 (storage and reader):
export { CellDefinitionsService } from "./cell-definitions.service"
export {
    canonicalJsonOf,
    definitionHashOf,
    documentHashOf,
    graphRefTextOf,
    refTextOf,
    sha256Of,
} from "./cell-hash.policy"
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
export { CellSeedService } from "./cell-seed.service"
export type { CellSeedRequest, CellSeedView } from "./cell-seed.service"
export { CellValidationService } from "./cell-validation.service"
export type { AcceptedCells } from "./cell-validation.service"
export { cellRefText, graphRefText, readCellPackage, readPackageManifest } from "./cell-package-files.mapper"
export type {
    CellPackageContent,
    CellPackageFiles,
    PackageCell,
    PackageFault,
    PackageGraph,
} from "./cell-package-files.mapper"
// S3 (runner):
export { CellRunnerClient, CAPABILITIES_BY_KIND, limitsHeldTo, readDirsOf, spawnPlanOf } from "./cell-runner.client"
export type { CellRunnerClientOptions } from "./cell-runner.client"
export { parseCellsConfig } from "./cells.config"
// S4 (executor, adapters, module wiring):
export { CELL_CAUSE, CellExecutorService, REFUSAL_CLASS_FACT } from "./cell-executor.service"
export { CellExpressionPolicy, EXPRESSION_MAX_DEPTH, isStoredExpr, isStoredRef } from "./cell-expression.policy"
export type { BoundLimits, ExpressionScope, IfConfig, IfDecision } from "./cell-expression.policy"
export { CellJsonSchemaPolicy } from "./cell-json-schema.policy"
export {
    CREDITS_EXHAUSTED_CODE,
    isDeclaredRefusal,
    isFinalRefusal,
    verdictOf,
    writesOutside,
} from "./cell-verdict.policy"
export { CellsLogEvent } from "./cells.log-events"
export type { CellsPortOverrides } from "./cells.module"
export { MemoryCellLedgerClient } from "./memory-cell-ledger.client"
export { MemoryCellMeterClient } from "./memory-cell-meter.client"
export type { MeterBookingView } from "./memory-cell-meter.client"
// S5 (test kit):
export { PROOF_CASES } from "./cell-proof.contracts"
export type {
    CellProof,
    CellProofWorld,
    CellProofWorlds,
    ProofBooking,
    ProofCaseId,
    ProofCaseResult,
    ProofDoorCall,
    ProofObservation,
    ProofToolReply,
} from "./cell-proof.contracts"
export { CELL_PROOF_WORLDS, InjectCellProofWorlds } from "./cell-proof.decorators"
export { CellProofService } from "./cell-proof.service"
