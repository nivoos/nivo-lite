import { UuidAbstractEntity } from "@modules/platform/database"
import { Column, Entity } from "typeorm"
import type {
    CellExample,
    CellKind,
    CellSemantics,
    JsonObject,
    JsonSchema,
    LocalizedText,
    ReviewState,
} from "../../cells.contracts"

@Entity({ schema: "cells", name: "definitions" })
/** One row of cells.definitions: one version of one cell of any kind. Frozen once approved (a trigger). */
export class CellDefinitionEntity extends UuidAbstractEntity {
    /** The package version that first carried it. */
    @Column({ name: "package_id", type: "uuid" })
    packageId!: string

    /** The kind of cell (a CHECK in the migration). */
    @Column({ name: "kind", type: "varchar" })
    kind!: CellKind

    /** The key (unique with the kind and the version). */
    @Column({ name: "key", type: "text" })
    key!: string

    /** The version. */
    @Column({ name: "version", type: "integer" })
    version!: number

    /** The title in both languages. */
    @Column({ name: "title", type: "jsonb" })
    title!: LocalizedText

    /** The input JSON Schema. */
    @Column({ name: "input_schema", type: "jsonb" })
    inputSchema!: JsonSchema

    /** The output JSON Schema. */
    @Column({ name: "output_schema", type: "jsonb" })
    outputSchema!: JsonSchema

    /** The config JSON Schema. */
    @Column({ name: "config_schema", type: "jsonb" })
    configSchema!: JsonSchema

    /** The behaviour facts the engine judges the cell by. */
    @Column({ name: "semantics", type: "jsonb" })
    semantics!: CellSemantics

    /** The kind's own part, validated by the kind's schema at seed time. */
    @Column({ name: "body", type: "jsonb", default: () => "'{}'::jsonb" })
    body!: JsonObject

    /** The stored source, when the cell has logic. */
    @Column({ name: "source_id", type: "uuid", nullable: true })
    sourceId!: string | null

    /** The sha256 of that source (the pair is one foreign key). */
    @Column({ name: "source_sha256", type: "varchar", nullable: true })
    sourceSha256!: string | null

    /** The examples the generic test kit runs. */
    @Column({ name: "examples", type: "jsonb", default: () => "'[]'::jsonb" })
    examples!: ReadonlyArray<CellExample>

    /** The sha256 of the canonical content of the version. */
    @Column({ name: "definition_hash", type: "varchar" })
    definitionHash!: string

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
