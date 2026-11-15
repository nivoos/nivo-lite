import { isRecord } from "@modules/platform/primitives"

/** The queue name: the contract between the record write door (the entity engine) and the api's delivery of a write event. */
export const RECORD_EVENTS_QUEUE = "record_events"

/** The jobs of the record-events queue; the value is the job name inside the queue. */
export enum RecordEventsJob {
    /** A record of a type that declares `events` was written: the api hands the write to the one event pipeline (`deliver`). */
    Deliver = "record-event.deliver",
}

/** What a write did to the record. */
export type RecordEventOp = "created" | "changed" | "deleted"

/** Who wrote: a step of a run, a person's action, a module job (concept agent-data, "writer"). */
export type RecordWriterKind = "run" | "action" | "job"

/**
 * The payload of a deliver job: one write of one record, ids only, plus what the event carries of the stored row (the declared subject
 * value and enum values), read in the write's own transaction so the event says what was written, not what is there later.
 */
export interface RecordEventPayload {
    /** The workspace of the record. */
    readonly workspaceId: string
    /** The agent that owns the record (the one that wrote it: writes are the owner's only). */
    readonly agentId: string
    /** The record type. */
    readonly type: string
    /** The record. */
    readonly recordId: string
    /** Its version after the write (decimal text): with the type and id, the event's once-key. */
    readonly version: string
    /** What the write did. */
    readonly op: RecordEventOp
    /** Who wrote. */
    readonly writer: RecordWriterKind
    /** The run whose step wrote, when one did. */
    readonly writerRunId: string | null
    /** The value of the type's declared subject (`id`: the record id). */
    readonly subject: string
    /** The person, when the declared subject is a contact field. */
    readonly contactId: string | null
    /** The declared enum `members` and their written values. */
    readonly fields: Readonly<Record<string, string>>
}

const TEXT_KEYS = ["workspaceId", "agentId", "type", "recordId", "version", "subject"] as const
const OPS: ReadonlyArray<string> = ["created", "changed", "deleted"]
const WRITERS: ReadonlyArray<string> = ["run", "action", "job"]

const nullableText = (value: unknown): boolean => value === null || (typeof value === "string" && value !== "")

/** True when a job payload is the payload of a deliver job. */
export const isRecordEventPayload = (value: unknown): value is RecordEventPayload =>
    isRecord(value) &&
    TEXT_KEYS.every((key) => typeof value[key] === "string" && value[key] !== "") &&
    typeof value["op"] === "string" &&
    OPS.includes(value["op"]) &&
    typeof value["writer"] === "string" &&
    WRITERS.includes(value["writer"]) &&
    nullableText(value["writerRunId"]) &&
    nullableText(value["contactId"]) &&
    isRecord(value["fields"]) &&
    Object.values(value["fields"]).every((entry) => typeof entry === "string")

/** The event id (and the dedupe key) of one write: a record's version is written once, so a redelivery is the same event. */
export const recordEventIdOf = (payload: Pick<RecordEventPayload, "type" | "recordId" | "version">): string =>
    `${payload.type}:${payload.recordId}:v${payload.version}`
