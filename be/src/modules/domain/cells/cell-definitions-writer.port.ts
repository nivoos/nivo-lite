import type { EntityManager } from "typeorm"
import type {
    CellPackageFile,
    CellPackageOrigin,
    CellRef,
    CellSourceInput,
    SeedReceiptInput,
    SeedReport,
    ValidatedCell,
    ValidatedGraph,
} from "./cells.contracts"

/**
 * The ONLY writer of the `cells.*` tables (CELLS-PLAN 2.1), and the reader of its own receipts (the seed's skip / force-once / removed-version
 * decision reads them in its transaction). Implemented by `CellDefinitionsService`; the seed calls it inside its own transaction, so every method
 * takes the manager. Its rules: a package version is keyed by (key, version) whatever the commit it is read from; a definition's hash covers its
 * content and its source sha256, never the package, the review state or the review reference.
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
    /** Whether a package commit was applied already, plain or forced as asked. */
    receiptExists(manager: EntityManager, packageKey: string, commit: string, forced: boolean): Promise<boolean>
    /** The report of the latest receipt of a package, or null when it was never applied. */
    lastReport(manager: EntityManager, packageKey: string): Promise<SeedReport | null>
}
