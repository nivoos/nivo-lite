import type { CellDefinitionView, CellGraphView, CellListFilter, CellRef, CellSourceView, GraphRef } from "./cells.contracts"

/**
 * The ONLY way the engine sees a cell (CELLS-PLAN 2.3). Implemented by slice S1 (`CellReaderService`, with a bounded cache); S2, S4 and S5
 * develop against `MemoryCellReader` until it lands.
 */
export interface CellReader {
    /** The exact version, deleted or not (a pinned run finishes); throws `CellsError` `CELLS_UNKNOWN`. */
    definition(ref: CellRef): Promise<CellDefinitionView>
    /** The exact graph version, deleted or not; throws `CELLS_UNKNOWN`. */
    graph(ref: GraphRef): Promise<CellGraphView>
    /** The source of a sha256; throws `CELLS_UNKNOWN`. */
    source(sha256: string): Promise<CellSourceView>
    /** The refs of approved, not deleted cells visible to the enterprise, of one kind when named. */
    listed(filter: CellListFilter): Promise<ReadonlyArray<CellRef>>
}
