import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import { z } from "zod"
import type { OptionalCanonicalEvent, TriggerDeclaration } from "@modules/domain/provider-triggers"
import type { RecordEventPayload } from "@modules/queues/record-events"
import { combineOf, isDefaultCombine, personKeyed, recordEventIdOf, type RecordEventsSource } from "./record-event-declaration.policy"

export type { RecordEventsSource }

/*
 * THE RECORD WRITE EVENT'S TRIGGER (concept agent-data rules 2, 3, 6, 7): ONE declaration per record type that declares `events`, DERIVED by
 * the engine from that declaration (no package writes a trigger): `nivo:record.written:<type>`, verb `nivo.trigger.record.written`, received
 * `internal` (the entity engine's outbox row in the write's own transaction). Its combine is the type's; its key is the type's declared
 * subject (a contact field: the person; anything else: `data.subject`, never assumed to be a person); an append-only type feeds the records
 * stream of its type. Pure: the translate reads only the payload the write door stored.
 */

/** The scope path of a write event's subject when it is no person (the correlation key `{ by: "data", member: "subject" }`). */
export const RECORD_SUBJECT_PATH = "data.subject"

/** The name prefix of a derived declaration: `record.written:<type>`. */
export const RECORD_WRITTEN = "record.written"

/** The data of a write event: ids, the op, the writer kind, the subject's value and the declared enum values. */
export type RecordWrittenData = Readonly<{
    type: string
    recordId: string
    op: string
    version: string
    writer: string
    subject: string
    fields: Readonly<Record<string, string>>
}>

const DATA = z.object({
    type: z.string(),
    recordId: z.string(),
    op: z.enum(["created", "changed", "deleted"]),
    version: z.string(),
    writer: z.enum(["run", "action", "job"]),
    subject: z.string(),
    fields: z.record(z.string(), z.string()),
})

const RAW = z.object({
    workspaceId: z.string(),
    agentId: z.string(),
    type: z.string(),
    recordId: z.string(),
    version: z.string(),
    op: z.enum(["created", "changed", "deleted"]),
    writer: z.enum(["run", "action", "job"]),
    writerRunId: z.string().nullable(),
    subject: z.string(),
    contactId: z.string().nullable(),
    fields: z.record(z.string(), z.string()),
})

/** The translate: one event per write; its id is the write's own (`<type>:<id>:v<version>`), so a redelivery is the same event. */
export const translateRecordWrite = (raw: RecordEventPayload): OptionalCanonicalEvent<RecordWrittenData> => ({
    id: recordEventIdOf(raw),
    data: {
        type: raw.type,
        recordId: raw.recordId,
        op: raw.op,
        version: raw.version,
        writer: raw.writer,
        subject: raw.subject,
        fields: { ...raw.fields },
    },
})

/** The declarations already derived, by the type declaration object (one object per type for the life of the process). */
const DERIVED = new WeakMap<object, TriggerDeclaration<RecordEventPayload, RecordWrittenData>>()

/** The derived declaration of a type that declares `events`, the same object every time it is asked. */
export const recordWrittenDeclarationOf = (source: RecordEventsSource): TriggerDeclaration<RecordEventPayload, RecordWrittenData> => {
    const kept = DERIVED.get(source)
    if (kept !== undefined) return kept
    const combine = combineOf(source)
    const declaration: TriggerDeclaration<RecordEventPayload, RecordWrittenData> = {
        provider: PROVIDER.nivo,
        name: `${RECORD_WRITTEN}:${source.name}`,
        verb: TRIGGER.recordWritten,
        via: ["internal"],
        // The write door writes the event's outbox row in the write's own transaction (record-event.deliver): a crash is a redelivery, a
        // failure runs the background ladder, then parks with one item for a person; nothing to poll.
        withoutPoll: {
            reason: {
                vi: "Sự kiện ghi bản ghi là một việc ghi cùng giao dịch với bản ghi (record-event.deliver): lỗi thì thử lại theo bậc, rồi dừng kèm một mục cho người xử lý.",
                en: "A record write event is a job written in the record's own transaction (record-event.deliver): a failure is retried on the ladder, then parked with one item for a person.",
            },
            source: "nivo:record-event.deliver",
        },
        words: {
            title: { vi: "Bản ghi · có bản ghi được ghi", en: "Records · a record was written" },
            summary: {
                vi: `Một bản ghi loại ${source.name} vừa được tạo, sửa hoặc xoá.`,
                en: `A record of type ${source.name} was created, changed or deleted.`,
            },
        },
        raw: RAW,
        data: DATA,
        translate: translateRecordWrite,
        key: personKeyed(source) ? { by: "contact" } : { by: "data", member: "subject" },
        settle: null,
        ...(isDefaultCombine(combine) ? {} : { combine }),
        ...(source.append === true ? { feeds: { stream: "records" as const, type: source.name } } : {}),
    }
    DERIVED.set(source, declaration)
    return declaration
}
