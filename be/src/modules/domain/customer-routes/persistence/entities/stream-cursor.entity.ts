import { Column, Entity, PrimaryColumn } from "typeorm"

@Entity({ schema: "public", name: "stream_cursors" })
/**
 * ONE consumer's position on ONE subject of ONE engine stream (concept agent-data rules 5, 8, 9): the agent that consumes, the stream
 * (`lines`, or a record type declared append-only), the subject (a route, or the type's declared subject value). `consumed_seq` is the newest
 * item a step of the agent read and then ENDED; before that end the read is pending (`read_seq` + `read_by`, the read's call key).
 */
export class StreamCursorEntity {
    /** The workspace. */
    @PrimaryColumn({ name: "workspace_id", type: "uuid" })
    workspaceId!: string

    /** The consuming agent. */
    @PrimaryColumn({ name: "agent_id", type: "uuid" })
    agentId!: string

    /** The stream: `lines` or a record type. */
    @PrimaryColumn({ name: "stream", type: "text" })
    stream!: string

    /** The subject of the stream. */
    @PrimaryColumn({ name: "subject", type: "text" })
    subject!: string

    /** The newest position consumed (bigint as text), or null while none. */
    @Column({ name: "consumed_seq", type: "bigint", nullable: true })
    consumedSeq!: string | null

    /** The newest position the pending read returned (both null, or both set with `readBy`). */
    @Column({ name: "read_seq", type: "bigint", nullable: true })
    readSeq!: string | null

    /** The call key of the pending read (`<run>:<step>:...`): the end of that step folds `readSeq` into the cursor. */
    @Column({ name: "read_by", type: "text", nullable: true })
    readBy!: string | null
}
