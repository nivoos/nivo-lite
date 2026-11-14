import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { CellProofWorlds } from "./cell-proof.contracts"

/** Token of the factory of proof worlds. */
export const CELL_PROOF_WORLDS: unique symbol = Symbol("domain.cells.proof-worlds")

/** Injects the factory of proof worlds. Parameter type: CellProofWorlds. */
export const InjectCellProofWorlds = (): TypedParameterDecorator<CellProofWorlds> => injector<CellProofWorlds>(CELL_PROOF_WORLDS)
