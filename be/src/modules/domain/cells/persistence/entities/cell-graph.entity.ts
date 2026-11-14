import { UuidAbstractEntity } from "@modules/platform/database"
import { Column, Entity } from "typeorm"
import type { CellGraphDocument, JsonObject, ReviewState } from "../../cells.contracts"

@Entity({ schema: "cells", name: "graphs" })
/** One row of cells.graphs: one version of one graph, naming exact cell versions. Frozen once approved (a trigger). */
export class CellGraphEntity extends UuidAbstractEntity {
    /** The package version that first carried it. */
    @Column({ name: "package_id", type: "uuid" })
    packageId!: string

    /** The key (unique with the version). */
    @Column({ name: "key", type: "text" })
    key!: string

    /** The version. */
    @Column({ name: "version", type: "integer" })
    version!: number

    /** The stored graph: steps with exact cell versions, triggers and the `vars` declaration. */
    @Column({ name: "document", type: "jsonb" })
    document!: CellGraphDocument

    /** The trigger list of the document, kept as its own column. */
    @Column({ name: "triggers", type: "jsonb", default: () => "'[]'::jsonb" })
    triggers!: ReadonlyArray<JsonObject>

    /** The sha256 of the canonical document. */
    @Column({ name: "document_hash", type: "varchar" })
    documentHash!: string

    /** Draft, approved or retired. */
    @Column({ name: "review_state", type: "varchar", default: "draft" })
    reviewState!: ReviewState

    /** `<repo>@<commit>` of a seeded row. */
    @Column({ name: "review_ref", type: "text", nullable: true })
    reviewRef!: string | null

    /** When the version was published. */
    @Column({ name: "published_at", type: "timestamptz", nullable: true })
    publishedAt!: Date | null

    /** When the version was soft-deleted. */
    @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
    deletedAt!: Date | null
}
