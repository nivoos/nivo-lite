import { Column, Entity, PrimaryColumn } from "typeorm"

@Entity({ schema: "public", name: "http_security_rate_windows" })
/** One rate limit window of one caller and tier, mapped from public.http_security_rate_windows of the initial migration in db/migrations. */
export class RateWindowEntity {
    /** The row id; the database default writes it, the natural key below is unique. */
    @PrimaryColumn({ name: "id", type: "uuid", default: () => "gen_random_uuid()" })
    id!: string

    /** The tier and caller address the window counts, unique. */
    @Column({ name: "key", type: "varchar", length: 128, unique: true })
    key!: string

    /** The hits counted in the window. */
    @Column({ name: "hits", type: "integer" })
    hits!: number

    /** When the window ends; a hit after it opens a fresh one. */
    @Column({ name: "reset_at", type: "timestamptz" })
    resetAt!: Date
}
