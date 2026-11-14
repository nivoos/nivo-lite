import { Column, Entity } from "typeorm"

import { UuidAbstractEntity } from "@modules/platform/database"

@Entity({ schema: "public", name: "contacts" })
/**
 * One person the agents work with (the engine's subject of a thread), whatever the source, stage or role. A `merged` or `erased` row is
 * a tombstone: the id stays so the history that names it does not dangle. `erased` (with `erased_at`) is the SOFT DELETE mark (owner
 * ruling R31): a deleted contact keeps its identities, memory, routes and customer lines, and every read leaves them out; the row is
 * never hard-deleted.
 */
export class ContactEntity extends UuidAbstractEntity {
    /** The workspace. */
    @Column({ name: "workspace_id", type: "uuid" })
    workspaceId!: string

    /** The name the person is shown by; null when nobody knows it. */
    @Column({ name: "display_name", type: "text", nullable: true })
    displayName!: string | null

    /** Generic labels. */
    @Column({ name: "tags", type: "text", array: true, default: () => "'{}'::text[]" })
    tags!: Array<string>

    /** `active`, `merged` or `erased`. */
    @Column({ name: "state", type: "text", default: "active" })
    state!: string

    /** When it was deleted (the soft-delete mark; always set with state `erased`), or null. */
    @Column({ name: "erased_at", type: "timestamptz", nullable: true })
    erasedAt!: Date | null

    /** The consent fact: true when the shop may not write to this person on its own initiative. */
    @Column({ name: "do_not_contact", type: "boolean", default: false })
    doNotContact!: boolean

    /** When the consent fact was last set or cleared, or null when never. */
    @Column({ name: "do_not_contact_at", type: "timestamptz", nullable: true })
    doNotContactAt!: Date | null

    /** Who changed it last: `member` or `step`; null when never. */
    @Column({ name: "do_not_contact_actor", type: "text", nullable: true })
    doNotContactActor!: string | null

    /** The member who changed it, or who approved the step's call; null when none did. */
    @Column({ name: "do_not_contact_decided_by", type: "text", nullable: true })
    doNotContactDecidedBy!: string | null

    /** The agent whose step's call set it; null for a member. */
    @Column({ name: "do_not_contact_agent_id", type: "uuid", nullable: true })
    doNotContactAgentId!: string | null

    /** The step whose call set it, when known; null for a member. */
    @Column({ name: "do_not_contact_step_key", type: "text", nullable: true })
    doNotContactStepKey!: string | null

    /** Why, as whoever changed it wrote it; null when none was given. */
    @Column({ name: "do_not_contact_reason", type: "text", nullable: true })
    doNotContactReason!: string | null
}
