import type { EntityManager } from "typeorm"
import type {
    CellPackageFile,
    CellPackageOrigin,
    CellRef,
    CellSourceInput,
    SeedReceiptInput,
    ValidatedCell,
    ValidatedGraph,
} from "./cells.contracts"

/**
 * The ONLY writer of the `cells.*` tables (CELLS-PLAN 2.1). Implemented by slice S1 (`CellDefinitionsService`); slice S2 calls it inside its
 * own transaction, so every method takes the manager. S2 develops against `MemoryCellDefinitionsWriter` until it lands.
 */
export interface CellDefinitionsWriter {
    /** Inserts (or finds) the package version row and answers its id. */
    putPackage(manager: EntityManager, file: CellPackageFile, origin: CellPackageOrigin): Promise<string>
    /** Stores a source by its sha256 (the text is never updated) and answers its id. */
    putSource(manager: EntityManager, source: CellSourceInput): Promise<string>
    /** Inserts a version row; the same content answers `unchanged`; other content throws `CELLS_VERSION_IMMUTABLE`. */
    putDefinition(manager: EntityManager, packageId: string, candidate: ValidatedCell): Promise<"created" | "unchanged">
    /** Inserts a graph version row, with the same rule as `putDefinition`. */
    putGraph(manager: EntityManager, packageId: string, graph: ValidatedGraph): Promise<"created" | "unchanged">
    /** Moves a version to `retired`, the one change an approved row may take. */
    retire(manager: EntityManager, ref: CellRef): Promise<void>
    /** Writes the receipt of an applied package commit. */
    receipt(manager: EntityManager, receipt: SeedReceiptInput): Promise<void>
}
