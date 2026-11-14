import { defineJob, type JobDefinition, type JobEffectDeclaration } from "@modules/platform/jobs"
import {
    VECTOR_SYNC_QUEUE,
    VectorSyncJob,
    isVectorReconcilePayload,
    isVectorSyncPayload,
    vectorReconcileDedupeKey,
    vectorSyncDedupeKey,
    type VectorReconcilePayload,
    type VectorSyncPayload,
} from "./vector-sync.contracts"

/** The outside effect of an embeddings call for rows that need a vector: made again under the same key when its outcome is lost (a paid call that changes nothing outside). */
export const VECTOR_EMBED_EFFECT: JobEffectDeclaration = { name: "knowledge.embed", settle: "repeatable" }

/** The outside effect of a write to the vector index (upsert or remove): idempotent by point id, so made again under the same key when its outcome is lost. */
export const VECTOR_WRITE_EFFECT: JobEffectDeclaration = { name: "vector.write", settle: "repeatable" }

/** The sync of the points of some rows (or of one document) with their Postgres rows. Background; the once key is the dedupe key of the change. */
export const SYNC_VECTORS_JOB: JobDefinition<VectorSyncPayload> = defineJob<VectorSyncPayload>({
    name: VectorSyncJob.Sync,
    queue: VECTOR_SYNC_QUEUE,
    ladder: "background",
    payload: isVectorSyncPayload,
    onceKey: vectorSyncDedupeKey,
    next: [],
    effects: [VECTOR_EMBED_EFFECT, VECTOR_WRITE_EFFECT],
})

/** One bounded run of the reconcile (the tick's own job, and its follow-up while it repairs and has budget left). Background. */
export const RECONCILE_VECTORS_JOB: JobDefinition<VectorReconcilePayload> = defineJob<VectorReconcilePayload>({
    name: VectorSyncJob.Reconcile,
    queue: VECTOR_SYNC_QUEUE,
    ladder: "background",
    payload: isVectorReconcilePayload,
    onceKey: (payload) => (payload.resumedAt === undefined ? VectorSyncJob.Reconcile : vectorReconcileDedupeKey(payload.resumedAt)),
    next: [VectorSyncJob.Reconcile],
    effects: [VECTOR_EMBED_EFFECT, VECTOR_WRITE_EFFECT],
})
