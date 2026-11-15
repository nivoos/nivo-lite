import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the cells capability (CELLS-PLAN 9.2). Slice 0 owns this list: a new code is requested from the coordinator. */
export enum CellsErrorCode {
    /** No cell, graph or source of that exact reference (`ref`). */
    Unknown = "CELLS_UNKNOWN",
    /** A cell of another kind than the one the caller asked for or the step names (`ref`, `expected`). */
    KindMismatch = "CELLS_KIND_MISMATCH",
    /** The input does not fit the cell input schema; nothing ran (`ref`, `path`). */
    InputInvalid = "CELLS_INPUT_INVALID",
    /** The output does not fit the cell output schema (`ref`, `path`). */
    OutputInvalid = "CELLS_OUTPUT_INVALID",
    /** A schema of the cell is not valid JSON Schema 2020-12 (`ref`, `path`). */
    SchemaInvalid = "CELLS_SCHEMA_INVALID",
    /** The `body` of the cell is outside its kind schema (`ref`, `path`). */
    BodyInvalid = "CELLS_BODY_INVALID",
    /** The semantics contradict themselves or the kind (`ref`, `reason`). */
    SemanticsInvalid = "CELLS_SEMANTICS_INVALID",
    /** A published (kind, key, version) was seeded again with other content: bump the version (`ref`). */
    VersionImmutable = "CELLS_VERSION_IMMUTABLE",
    /** A stored source uses `import`, `export` or `require` (`ref`). */
    SourceImports = "CELLS_SOURCE_IMPORTS",
    /** A stored source does not parse (`ref`, `detail`). */
    SourceSyntax = "CELLS_SOURCE_SYNTAX",
    /** The text of a source does not hash to the sha256 it was asked for (`sha256`). */
    SourceHashMismatch = "CELLS_SOURCE_HASH_MISMATCH",
    /** A source called a tool its cell did not declare (`ref`, `tool`). */
    ToolUndeclared = "CELLS_TOOL_UNDECLARED",
    /** A cell answered a refusal code its semantics did not declare (`ref`, `code`). */
    RefusalUndeclared = "CELLS_REFUSAL_UNDECLARED",
    /** A graph step names a cell version that does not exist (`graph`, `step`, `ref`). */
    GraphRefUnknown = "CELLS_GRAPH_REF_UNKNOWN",
    /** A graph route points to a step that does not exist (`graph`, `step`, `route`). */
    GraphRouteMissing = "CELLS_GRAPH_ROUTE_MISSING",
    /** A graph has a cycle outside a loop (`graph`, `step`). */
    GraphCycle = "CELLS_GRAPH_CYCLE",
    /** A stored expression is deeper than 4 or its types do not fit (`path`, `reason`). */
    ExprInvalid = "CELLS_EXPR_INVALID",
    /** An example of the cell did not give the outcome it expects (`ref`, `example`). */
    ExampleFailed = "CELLS_EXAMPLE_FAILED",
    /** A source ran past its limits: memory, stack, cpu, wall clock, output or call count (`ref`, `limit`). */
    RunnerLimits = "CELLS_RUNNER_LIMITS",
    /** The runner process died or broke the protocol (`ref`). */
    RunnerCrashed = "CELLS_RUNNER_CRASHED",
    /** A package file (`cells.package.yaml`, a `cell.yaml`, a `graph.yaml`) is missing, unreadable or malformed (`file`, `reason`). */
    PackageInvalid = "CELLS_PACKAGE_INVALID",
    /** A `core.set` or a `$ref` names a workflow variable the graph does not declare (`graph`, `step`, `name`). CELLS-DECISIONS D1. */
    VarUndeclared = "CELLS_VAR_UNDECLARED",
    /** Two parallel branches write the same variable in one super-step and it declares no merge (`graph`, `name`, `steps`). CELLS-DECISIONS D1. */
    VarWriteConflict = "CELLS_VAR_WRITE_CONFLICT",
    /** The module was registered to execute cells without a tool door: there is no default door, so registration refuses it (`module`). */
    ToolDoorMissing = "CELLS_TOOL_DOOR_MISSING",
}

/** How each cells code travels. */
export const CELLS_ERROR_KINDS: Record<CellsErrorCode, ErrorKind> = {
    [CellsErrorCode.Unknown]: "not-found",
    [CellsErrorCode.KindMismatch]: "invalid",
    [CellsErrorCode.InputInvalid]: "invalid",
    [CellsErrorCode.OutputInvalid]: "internal",
    [CellsErrorCode.SchemaInvalid]: "invalid",
    [CellsErrorCode.BodyInvalid]: "invalid",
    [CellsErrorCode.SemanticsInvalid]: "invalid",
    [CellsErrorCode.VersionImmutable]: "conflict",
    [CellsErrorCode.SourceImports]: "invalid",
    [CellsErrorCode.SourceSyntax]: "invalid",
    [CellsErrorCode.SourceHashMismatch]: "conflict",
    [CellsErrorCode.ToolUndeclared]: "invalid",
    [CellsErrorCode.RefusalUndeclared]: "invalid",
    [CellsErrorCode.GraphRefUnknown]: "invalid",
    [CellsErrorCode.GraphRouteMissing]: "invalid",
    [CellsErrorCode.GraphCycle]: "invalid",
    [CellsErrorCode.ExprInvalid]: "invalid",
    [CellsErrorCode.ExampleFailed]: "invalid",
    [CellsErrorCode.RunnerLimits]: "unavailable",
    [CellsErrorCode.RunnerCrashed]: "internal",
    [CellsErrorCode.PackageInvalid]: "invalid",
    [CellsErrorCode.VarUndeclared]: "invalid",
    [CellsErrorCode.VarWriteConflict]: "conflict",
    [CellsErrorCode.ToolDoorMissing]: "internal",
}

/** The one error class of the cells capability. */
export class CellsError extends DomainError<CellsErrorCode> {}
