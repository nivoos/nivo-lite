import { UuidAbstractEntity } from "@modules/platform/database"
import { Column, Entity } from "typeorm"
import type { SeedReport } from "../../cells.contracts"

@Entity({ schema: "cells", name: "seed_receipts" })
/** One row of cells.seed_receipts: the apply of one package commit, with what it did cell by cell. Append only. */
export class CellSeedReceiptEntity extends UuidAbstractEntity {
    /** The package key. */
    @Column({ name: "package_key", type: "text" })
    packageKey!: string

    /** The repository the commit was read from. */
    @Column({ name: "repository", type: "text" })
    repository!: string

    /** The commit applied. */
    @Column({ name: "commit", type: "text" })
    commit!: string

    /** True for the one extra apply a declared force allows. */
    @Column({ name: "forced", type: "boolean", default: false })
    forced!: boolean

    /** What the apply did, cell by cell. */
    @Column({ name: "report", type: "jsonb" })
    report!: SeedReport
}
