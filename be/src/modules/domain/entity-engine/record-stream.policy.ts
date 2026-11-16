import type { WriteValues } from "@nivo-lite/agent-sdk/entity/port"

/*
 * A RECORD TYPE AS A STREAM (concept agent-data rules 5, 10, 12), the engine's pure half. A type the package declares `append: true` holds
 * FACTS: the engine refuses to change one after it is written (`update`, `upsert`), and an insert of one takes the lock of its stream subject
 * (the value of `events.subject`) before the database numbers it. The members are read STRUCTURALLY from the declaration (agent-sdk S1:
 * `EntityConfig.append`, `.events`), so the engine reads them from whichever SDK build it is compiled with.
 */

/** The members of a record type declaration this policy reads. */
interface StreamMembers {
    readonly append?: unknown
    readonly events?: { readonly subject?: unknown } | undefined
}

/** The subject of a type whose records are each their own subject: no two appends share a stream, so none waits on another. */
const RECORD_ITSELF = "id"

/** True for a record type declared append-only (its rows are facts: never changed after insert). */
export const isAppendOnly = (definition: object): boolean => (definition as StreamMembers).append === true

/**
 * The stream subject an insert of an append-only type locks: the type's name and the written value of its `events.subject` field, or null
 * when the type is not append-only or its subject is the record itself (`id`: a new record shares a stream with no other).
 */
export const streamSubjectOf = (
    definition: { readonly name: string },
    values: WriteValues,
): { readonly stream: string; readonly subject: string } | null => {
    if (!isAppendOnly(definition)) return null
    const field = (definition as StreamMembers).events?.subject
    if (typeof field !== "string" || field === RECORD_ITSELF) return null
    // A subject field is a scalar (uuid, text, enum, int, bigint, contact: the SDK refuses any other kind at module load).
    const value = values[field]
    const subject = typeof value === "string" || typeof value === "number" ? String(value) : ""
    return { stream: definition.name, subject }
}

/** The members of a declaration's `events` this policy reads (S1: `RecordEventsDef`), structurally. */
interface EventsMembers {
    readonly events?: { readonly subject?: unknown; readonly members?: unknown } | undefined
    readonly fields: Readonly<Record<string, { readonly kind: string }>>
}

/** The declared events of a type, or null when it declares none: its subject (`id` or a field) and its enum members. */
export const recordEventsOf = (
    definition: object,
): { readonly subject: string; readonly members: ReadonlyArray<string> } | null => {
    const events = (definition as EventsMembers).events
    if (events === undefined || typeof events.subject !== "string") return null
    const members = Array.isArray(events.members) ? events.members.filter((member): member is string => typeof member === "string") : []
    return { subject: events.subject, members }
}

/** A scalar value of a stored field as text, or null (absent, null, or not a scalar). */
const textOf = (value: unknown): string | null =>
    typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : null

/**
 * What a write event of a record carries of the stored row (concept agent-data rule 2): the declared subject's value (`id`: the record
 * itself), the person when the subject is a contact field, and the declared enum members' values. Null when the type declares no events.
 */
export const writtenOf = (
    definition: object,
    row: { readonly id: string; readonly data: Readonly<Record<string, unknown>> },
): { readonly subject: string; readonly contactId: string | null; readonly fields: Readonly<Record<string, string>> } | null => {
    const events = recordEventsOf(definition)
    if (events === null) return null
    const { fields } = definition as EventsMembers
    const subject = events.subject === "id" ? row.id : (textOf(row.data[events.subject]) ?? "")
    const contactId = events.subject !== "id" && fields[events.subject]?.kind === "contact" && subject !== "" ? subject : null
    const written = events.members.flatMap((member) => {
        const value = textOf(row.data[member])
        return value === null ? [] : [[member, value] as const]
    })
    return { subject, contactId, fields: Object.fromEntries(written) }
}
