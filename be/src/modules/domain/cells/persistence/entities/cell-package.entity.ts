import { UuidAbstractEntity } from "@modules/platform/database"
import { Column, Entity } from "typeorm"

@Entity({ schema: "cells", name: "packages" })
/** One row of cells.packages: a seeded package version and who may see its cells. */
export class CellPackageEntity extends UuidAbstractEntity {
    /** The package key. */
    @Column({ name: "key", type: "text" })
    key!: string

    /** The package version (unique with the key). */
    @Column({ name: "version", type: "text" })
    version!: string

    /** Who sees its cells: every workspace, or only the enterprises listed. */
    @Column({ name: "visibility", type: "varchar" })
    visibility!: "public" | "private"

    /** The enterprise identifiers that see a private package; empty for a public one. */
    @Column({ name: "enterprises", type: "text", array: true, default: () => "'{}'::text[]" })
    enterprises!: Array<string>

    /** The author of the package. */
    @Column({ name: "author", type: "text" })
    author!: string

    /** The repository the package was read from. */
    @Column({ name: "repository", type: "text" })
    repository!: string

    /** The commit the package was read at. */
    @Column({ name: "commit", type: "text" })
    commit!: string

    /** When the package version was soft-deleted. */
    @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
    deletedAt!: Date | null
}
