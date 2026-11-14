import { UuidAbstractEntity } from "@modules/platform/database"
import { Column, Entity } from "typeorm"

@Entity({ schema: "public", name: "brain_source_critiques" })
/** Where the critique of one shop document stands: a row of public.brain_source_critiques (one per document). */
export class SourceCritiqueEntity extends UuidAbstractEntity {
    /** The workspace. */
    @Column({ name: "workspace_id", type: "uuid" })
    workspaceId!: string

    /** The document; the row goes with it. */
    @Column({ name: "source_id", type: "uuid" })
    sourceId!: string

    /** waiting, running, done or not_done; the table checks it. */
    @Column({ name: "state", type: "text", default: () => "'waiting'::text" })
    state!: "waiting" | "running" | "done" | "not_done"

    /** Why it is not done: model, credits, facts_unread or budget; null otherwise. */
    @Column({ name: "reason", type: "text", nullable: true })
    reason!: "model" | "credits" | "facts_unread" | "budget" | null

    /**
     * The count of runs in a row without progress (D-V-1; the table checks 0..3). NOTHING COUNTS RUNS ANY MORE (the review job's ladder
     * and dead letter judge a failure): a new request writes 0 and it stays 0. The column and its API field go with the next schema
     * wave (a migration and the page's query), not before.
     */
    @Column({ name: "attempts", type: "smallint", default: () => "0" })
    attempts!: number

    /**
     * The hashes (`passageTextHashOf`) of the passages a finished security read reviewed: a later upload is read only outside them,
     * and a passage is served to customers only once reviewed (`regate`); no truth waits for it.
     */
    @Column({ name: "reviewed_hashes", type: "text", array: true, default: () => "'{}'::text[]" })
    reviewedHashes!: Array<string>

    /** Model calls made for this document, in total. */
    @Column({ name: "model_calls", type: "integer", default: () => "0" })
    modelCalls!: number

    /** Prompt tokens of those calls, in total. */
    @Column({ name: "prompt_tokens", type: "integer", default: () => "0" })
    promptTokens!: number

    /** When the critique was last asked for. */
    @Column({ name: "requested_at", type: "timestamptz" })
    requestedAt!: Date

    /** When it last started. */
    @Column({ name: "started_at", type: "timestamptz", nullable: true })
    startedAt!: Date | null

    /** When it last ended. */
    @Column({ name: "finished_at", type: "timestamptz", nullable: true })
    finishedAt!: Date | null

    /** The founder who let customers read the document without a finished critique. */
    @Column({ name: "released_by", type: "uuid", nullable: true })
    releasedBy!: string | null

    /** When. */
    @Column({ name: "released_at", type: "timestamptz", nullable: true })
    releasedAt!: Date | null

    /** Passages of the document no finished security read has reviewed yet (withheld from customers until one does), migration 20261112015400. */
    @Column({ name: "waiting_passages", type: "integer", default: () => "0" })
    waitingPassages!: number

    /**
     * The marks of the DELETED per-truth verification (owner 2026-11-12): nothing writes or reads them any more; old rows keep theirs.
     * The column stays (no migration). Migration 20261112021400.
     */
    @Column({ name: "verified_truths", type: "text", array: true, default: () => "'{}'::text[]" })
    verifiedTruths!: Array<string>
}
