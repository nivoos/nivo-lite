import { INGEST_STAGES, ingestStageOf } from "./ingest-stages"
import type { ModuleLabelOf } from "@/modules/catalog"
import { isDocumentActive, noteKeyOf } from "./status"
import { docGlyphOf } from "./docs-rows"
import type { KnowledgeFormat, KnowledgeTranslate } from "./docs-translate"
import type {
    DocumentPassage,
    KnowledgeDocument,
    KnowledgeDocumentDetail,
    NivoEntry,
    DocBodyView,
    DocChipView,
    DocFactView,
    DocHeadView,
    DocMenuItemView,
    DocOpenedView,
    NivoBodyView,
} from "@/modules/types"

/** Bytes in a megabyte, for the size of a file. */
const BYTES_PER_MB = 1_048_576

/** The label of the agent a document is kept for, or of every agent. */
const moduleLabelOf = (t: KnowledgeTranslate, labelOf: ModuleLabelOf, module: string | null): string =>
    module === null ? t("moduleAll") : (labelOf(module) ?? module)

/** The day and month of a moment, as the artboards write them ("02/11"). */
const dayOf = (format: KnowledgeFormat, iso: string): string =>
    format.dateTime(new Date(iso), { day: "2-digit", month: "2-digit" })

/** The day and the time of a moment (day, month, hour, minute). */
const dayTimeOf = (format: KnowledgeFormat, iso: string): string =>
    `${dayOf(format, iso)} · ${format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" })}`

/** The kind of a document with its size when it holds bytes (for example a file of 0.2 MB). */
const kindTextOf = (t: KnowledgeTranslate, format: KnowledgeFormat, source: KnowledgeDocument): string =>
    source.sizeBytes <= 0
        ? t(`kind_${source.kind}`)
        : t("kindSized", {
              kind: t(`kind_${source.kind}`),
              size: format.number(Math.max(0.1, source.sizeBytes / BYTES_PER_MB), { maximumFractionDigits: 1 }),
          })

/** Where a document came from, in words: its origin when it has one, else how it was added. */
const sourceTextOf = (t: KnowledgeTranslate, source: KnowledgeDocument): string => {
    if (source.origin === "google_drive") return t("sourceDrive")
    if (source.origin === "public_document") return t("sourcePublic")
    if (source.origin?.startsWith("seed:") === true) return t("sourceSeed")
    if (source.kind === "file") return t("sourceUpload")
    return t(source.kind === "url" ? "sourceLink" : "sourceWritten")
}

/** The facts of the details pane of a document. */
export const docFactsOf = (
    t: KnowledgeTranslate,
    format: KnowledgeFormat,
    source: KnowledgeDocument,
    labelOf: ModuleLabelOf,
): ReadonlyArray<DocFactView> => [
    { id: "kind", term: t("factKind"), text: kindTextOf(t, format, source) },
    { id: "source", term: t("factSource"), text: sourceTextOf(t, source) },
    { id: "topic", term: t("factTopic"), text: source.topic ?? t("addNoTopic") },
    ...(source.tags.length === 0 ? [] : [{ id: "tags", term: t("factTags"), text: source.tags.join(", ") }]),
    { id: "for", term: t("factFor"), text: moduleLabelOf(t, labelOf, source.module) },
    {
        id: "who",
        term: t("factWho"),
        text: t(source.visibility === "public" ? "visPublicLong" : "factWhoInternal"),
    },
    { id: "added", term: t("factAdded"), text: dayTimeOf(format, source.createdAt) },
]

/** What the head of an opened document needs from its commands. */
interface DocHeadInput {
    readonly canWrite: boolean
    readonly busy: "reindex" | "delete" | "area" | null
    /** The commands of the row (read again, read the facts again, apply them, take them back), already worded. */
    readonly rowActions: ReadonlyArray<DocMenuItemView>
    readonly chip: DocChipView | null
}

/** The command that moves a document to the other area, worded by where it stands now; none for a reader who may not write. */
const areaOf = (t: KnowledgeTranslate, source: KnowledgeDocumentDetail, input: DocHeadInput): DocHeadView["area"] => {
    if (!input.canWrite) return null
    const toPublic = source.visibility === "internal"
    const key = toPublic ? "areaToPublic" : "areaToInternal"
    return {
        label: t(key),
        isPending: input.busy === "area",
        confirm: {
            title: t(`${key}Title`, { name: source.title }),
            description: t(`${key}Body`),
            confirmLabel: t(key),
            cancelLabel: t("addCancel"),
        },
    }
}

/** The head band of an opened document: where it stands and who may read it, the one line, "read again" and the menu. */
export const docHeadOf = (
    t: KnowledgeTranslate,
    format: KnowledgeFormat,
    source: KnowledgeDocumentDetail,
    input: DocHeadInput,
    chunkCount: number,
): DocHeadView => ({
    title: source.title,
    meta: [
        t("detailMeta", { when: dayOf(format, source.createdAt) }),
        t(`kind_${source.kind}`),
        t("passagesCount", { count: chunkCount }),
    ].join(" · "),
    glyph: docGlyphOf(source),
    chips: [
        ...(input.chip === null ? [] : [input.chip]),
        {
            label: t(source.visibility === "public" ? "vis_public" : "vis_internal"),
            tone: "neutral",
        },
    ],
    reindex: input.canWrite
        ? {
              label: input.busy === "reindex" ? t("reindexing") : t("reindex"),
              isPending: input.busy === "reindex",
              isDisabled: isDocumentActive(source.status),
          }
        : null,
    menu: input.canWrite
        ? [...input.rowActions, { id: "delete", label: t("removeConfirm"), tone: "danger" as const }]
        : [],
    area: areaOf(t, source, input),
    remove: input.canWrite
        ? {
              title: t("removeTitle", { name: source.title }),
              description: t("removeBody"),
              confirmLabel: t("removeConfirm"),
              cancelLabel: t("addCancel"),
              isPending: input.busy === "delete",
          }
        : null,
})

/** The body of an opened document: the note it carries, the stage a worker is on, its passages and its text. */
export const docBodyOf = (
    t: KnowledgeTranslate,
    source: KnowledgeDocumentDetail,
    chunks: ReadonlyArray<DocumentPassage>,
): DocBodyView => {
    const stage = ingestStageOf(source.status, source.stage)
    return {
        note:
            source.error === null
                ? null
                : {
                      text: t(noteKeyOf(source.error)),
                      tone: source.status === "failed" ? "negative" : "cautionary",
                  },
        stage:
            stage === null || !isDocumentActive(source.status)
                ? null
                : {
                      label: t("processingSteps"),
                      steps: INGEST_STAGES.map((id) => ({ id, label: t(`ingest_${id}`) })),
                      currentId: stage,
                  },
        passages: {
            title: t("passagesTitle"),
            count: t("passagesCount", { count: chunks.length }),
            hint: t("passagesHint"),
            rows: chunks.map((chunk) => ({
                id: chunk.id,
                text: chunk.content,
                chip: t(chunk.hasEmbedding ? "passageVector" : "passageKeyword"),
            })),
            emptyLabel: t("passagesEmpty"),
        },
        content: { title: t("contentTitle"), text: source.content },
    }
}

/** The opened item of the base knowledge: a head band with its "read only" chip, the notice and its lines, and its facts. */
export const nivoOpenedOf = (
    t: KnowledgeTranslate,
    format: KnowledgeFormat,
    item: NivoEntry,
    labelOf: ModuleLabelOf,
): DocOpenedView<NivoBodyView> => ({
    head: {
        title: item.title,
        meta: `${t("nivoTitle")} · ${t("nivoVersion", { version: item.version })}`,
        glyph: "nivo",
        chips: [{ label: t("readOnlyChip"), tone: "neutral" }],
        reindex: null,
        menu: [],
        area: null,
        remove: null,
    },
    body: {
        noticeTitle: t("nivoNoticeTitle"),
        noticeBody: t("nivoNoticeBody"),
        contentTitle: t("nivoContent"),
        lines: item.body.split(/\r?\n/u).filter((line) => line.trim() !== ""),
    },
    facts: [
        { id: "kind", term: t("factKind"), text: t(`nivoKind_${item.kind}`) },
        {
            id: "version",
            term: t("factVersion"),
            text: t("factVersionValue", { version: item.version, when: dayOf(format, item.updatedAt) }),
        },
        {
            id: "for",
            term: t("factFor"),
            text: labelOf(item.module) ?? t("moduleCore"),
        },
        { id: "editor", term: t("factEditor"), text: t("factEditorValue") },
    ],
})
