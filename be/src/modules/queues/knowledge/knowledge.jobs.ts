import { defineJob, type JobDefinition, type JobEffectDeclaration, type JobProgressTopic } from "@modules/platform/jobs"
import { VectorSyncJob } from "@modules/queues/vector-sync"
import {
    KNOWLEDGE_INDEX_QUEUE,
    KNOWLEDGE_QUEUE,
    KnowledgeJob,
    isBrainJobPayload,
    isBrainWorkspaceUpkeepPayload,
    isDossierReviewPayload,
    isKnowledgeCommandPayload,
    isKnowledgeSourcePayload,
    isPolicyDerivePayload,
    isPublicDraftPayload,
    knowledgeDedupeKey,
    type BrainJobPayload,
    type DossierReviewPayload,
    type KnowledgeSourcePayload,
    type PolicyDerivePayload,
    type PublicDraftPayload,
} from "./knowledge.contracts"

/** The topic every job of one source's chain (upload, index, facts, vectors) reports on: the workspace, then the source (ids only). */
const sourceTopicOf = (payload: KnowledgeSourcePayload): JobProgressTopic => ({
    workspaceId: payload.workspaceId,
    root: `knowledge-source:${payload.sourceId}`,
})

/** The outside effect of reading a source: a file from storage, a page over HTTP, a picture transcribed by a model. Made again under the same key when its outcome is lost: a read changes nothing. */
export const READ_EFFECT: JobEffectDeclaration = { name: "knowledge.read", settle: "repeatable" }

/** The outside effect of an embeddings call, one per batch of passages: a paid call that changes nothing outside; made again when its outcome is lost (at most one batch is paid twice). */
export const EMBED_EFFECT: JobEffectDeclaration = { name: "knowledge.embed", settle: "repeatable" }

/** The outside effect of a model call that judges or extracts: it changes nothing outside; made again when its outcome is lost. */
export const MODEL_EFFECT: JobEffectDeclaration = { name: "brain.model", settle: "repeatable" }

/**
 * The index job of a source: a person has just uploaded or changed it and watches the bar, so it is on the `waited` ladder. It reads,
 * cuts, embeds and stores the passages, then hands over in the transaction that finishes it: the event `knowledge_source_indexed` (whose
 * reactor queues the facts job) and the vector sync of the source. The once key is the dedupe key it always had.
 */
export const INDEX_SOURCE_JOB: JobDefinition<KnowledgeSourcePayload> = defineJob<KnowledgeSourcePayload>({
    name: KnowledgeJob.Index,
    queue: KNOWLEDGE_INDEX_QUEUE,
    ladder: "waited",
    payload: isKnowledgeSourcePayload,
    onceKey: (payload) => knowledgeDedupeKey(KnowledgeJob.Index, payload.sourceId, payload.again),
    next: [KnowledgeJob.Facts, VectorSyncJob.Sync],
    effects: [READ_EFFECT, EMBED_EFFECT],
    progress: { topic: sourceTopicOf },
})

/**
 * The facts job of an indexed source (triage, extraction, settle) and its own follow-up when its budget of model calls is spent. Nobody
 * watches a document's truths come, so it is `background`. Facts that change start the policy derive through the facts store's
 * announcement (the derive pass of the workspace is the job `brain.policies`).
 */
export const EXTRACT_FACTS_JOB: JobDefinition<KnowledgeSourcePayload> = defineJob<KnowledgeSourcePayload>({
    name: KnowledgeJob.Facts,
    queue: KNOWLEDGE_QUEUE,
    ladder: "background",
    payload: isKnowledgeSourcePayload,
    onceKey: (payload) => knowledgeDedupeKey(KnowledgeJob.Facts, payload.sourceId, payload.again),
    next: [KnowledgeJob.Facts, KnowledgeJob.PolicyDerive, VectorSyncJob.Sync],
    effects: [MODEL_EFFECT],
    progress: { topic: sourceTopicOf },
})

/** The derive pass of a workspace's policies from its truth graph, and its follow-up pass while candidates are left. `background`. */
export const DERIVE_POLICIES_JOB: JobDefinition<PolicyDerivePayload> = defineJob<PolicyDerivePayload>({
    name: KnowledgeJob.PolicyDerive,
    queue: KNOWLEDGE_QUEUE,
    ladder: "background",
    payload: isPolicyDerivePayload,
    onceKey: (payload) => knowledgeDedupeKey(KnowledgeJob.PolicyDerive, payload.workspaceId, `at:${String(payload.askedAt ?? 0)}`),
    next: [KnowledgeJob.PolicyDerive],
    effects: [MODEL_EFFECT],
})

/** The outside effect of a paid model call of a command (`lessons.mine`): a generation run in the command's process, its answer kept by the generation's own effect, keyed by the job. */
export const COMMAND_MODEL_EFFECT: JobEffectDeclaration = { name: "agents.generate", settle: "repeatable" }

/** The outside effect of the critic model's read of one stretch of a shop document: it changes nothing outside; its answer (a bounded list of points) is kept so a run again never reads the stretch twice. */
export const CRITIC_MODEL_EFFECT: JobEffectDeclaration = { name: "dossier.critique", settle: "repeatable" }

/** The outside effect of the model call that writes one public document draft: it changes nothing outside; its answer is kept so a run again never writes (or bills) the draft twice. */
export const DRAFT_MODEL_EFFECT: JobEffectDeclaration = { name: "public.draft", settle: "repeatable" }

/**
 * The brain command job: a command a person asked for on the Second Brain or Knowledge page (the page polls the row, so a person waits:
 * the `waited` ladder), the timed upkeep tick, and the upkeep of one workspace the tick's job queues for each workspace where it is due
 * (so one workspace that fails retries and parks alone, never holding the others back). The once key of a command is its row; the tick's
 * is its own name (the tick writes its own minute key); a workspace's upkeep is keyed by the workspace and the tick's minute.
 */
export const RUN_BRAIN_COMMAND_JOB: JobDefinition<BrainJobPayload> = defineJob<BrainJobPayload>({
    name: KnowledgeJob.BrainCommand,
    queue: KNOWLEDGE_QUEUE,
    ladder: "waited",
    payload: isBrainJobPayload,
    onceKey: (payload) => {
        if (isKnowledgeCommandPayload(payload)) return knowledgeDedupeKey(KnowledgeJob.BrainCommand, payload.commandId)
        if (isBrainWorkspaceUpkeepPayload(payload)) return knowledgeDedupeKey(KnowledgeJob.BrainCommand, payload.workspaceId, `upkeep:${String(payload.at)}`)
        return knowledgeDedupeKey(KnowledgeJob.BrainCommand, "upkeep")
    },
    next: [KnowledgeJob.BrainCommand, KnowledgeJob.Facts, KnowledgeJob.Index, KnowledgeJob.DossierReview],
    effects: [COMMAND_MODEL_EFFECT],
})

/**
 * One run of the shop-document critic: it reads the critiques that wait in a workspace (one batch) and queues a follow-up run when more
 * wait. Nobody watches a critique come, so it is `background`; the once key is the run row.
 */
export const REVIEW_DOSSIERS_JOB: JobDefinition<DossierReviewPayload> = defineJob<DossierReviewPayload>({
    name: KnowledgeJob.DossierReview,
    queue: KNOWLEDGE_QUEUE,
    ladder: "background",
    payload: isDossierReviewPayload,
    onceKey: (payload) => knowledgeDedupeKey(KnowledgeJob.DossierReview, payload.runId),
    next: [KnowledgeJob.DossierReview],
    effects: [CRITIC_MODEL_EFFECT],
})

/**
 * The draft of a public document (an owner's draft or a proposal for a customer question): the owner asked and the row says `drafting`
 * while a person looks at it, so it is `waited`. The once key is the document and its revision.
 */
export const DRAFT_PUBLIC_DOCUMENT_JOB: JobDefinition<PublicDraftPayload> = defineJob<PublicDraftPayload>({
    name: KnowledgeJob.PublicDraft,
    queue: KNOWLEDGE_QUEUE,
    ladder: "waited",
    payload: isPublicDraftPayload,
    onceKey: (payload) => knowledgeDedupeKey(KnowledgeJob.PublicDraft, payload.documentId, `revision:${String(payload.draftRevision)}`),
    next: [],
    effects: [DRAFT_MODEL_EFFECT],
})
