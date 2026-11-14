import { UuidAbstractEntity } from "@modules/platform/database"
import { Column, Entity } from "typeorm"

@Entity({ schema: "cells", name: "sources" })
/** One row of cells.sources: the logic text of a cell, addressed by its sha256 and never changed. */
export class CellSourceEntity extends UuidAbstractEntity {
    /** The language and runtime version of the text. */
    @Column({ name: "language", type: "varchar" })
    language!: "js-quickjs@1"

    /** The text. */
    @Column({ name: "text", type: "text" })
    text!: string

    /** The sha256 hex of the text (unique). */
    @Column({ name: "sha256", type: "varchar" })
    sha256!: string

    /** The size of the text in bytes (UTF-8). */
    @Column({ name: "bytes", type: "integer" })
    bytes!: number

    /** Whether NIVO or a package wrote it. */
    @Column({ name: "author_kind", type: "varchar" })
    authorKind!: "nivo" | "package"

    /** Who wrote it: a person or a package key. */
    @Column({ name: "author_ref", type: "text" })
    authorRef!: string
}
