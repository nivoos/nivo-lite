import { CellDefinitionEntity } from "./cell-definition.entity"
import { CellGraphEntity } from "./cell-graph.entity"
import { CellPackageEntity } from "./cell-package.entity"
import { CellSeedReceiptEntity } from "./cell-seed-receipt.entity"
import { CellSourceEntity } from "./cell-source.entity"

export { CellDefinitionEntity, CellGraphEntity, CellPackageEntity, CellSeedReceiptEntity, CellSourceEntity }

/** The entities the cells capability owns, for the app's connection (the plan's CELLS_ENTITIES, named as every capability names its list). */
export const cellsEntities: readonly [
    typeof CellPackageEntity,
    typeof CellSourceEntity,
    typeof CellDefinitionEntity,
    typeof CellGraphEntity,
    typeof CellSeedReceiptEntity,
] = [CellPackageEntity, CellSourceEntity, CellDefinitionEntity, CellGraphEntity, CellSeedReceiptEntity] as const
