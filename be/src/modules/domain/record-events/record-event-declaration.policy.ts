import { DEFAULT_TRIGGER_COMBINE, isTriggerCombine, type TriggerCombine } from "@nivo-lite/agent-sdk/graph"
export { recordEventIdOf } from "@modules/queues/record-events"

// What the derived trigger declaration of a record type (`record-written.trigger.ts`) reads from the type's own declaration and from the write's
// payload contract, kept here so the declaration file holds the declaration and its pure translate only (project check
// `engine-business-contracts` D1: a trigger declaration file imports values from its own folder and the listed schema libraries). Nothing here
// reads or writes anything: the type's declaration in, a word out.

/** What a record type declares that its write events read (S1 `EntityConfig.append` / `.events`), read structurally. */
export interface RecordEventsSource {
    /** The record type's name (`<package>.<agent>.<domain>`). */
    readonly name: string
    /** True for an append-only type: its writes feed the records stream of the type. */
    readonly append?: unknown
    /** The write events the type declares (the subject member, the combine, the members whose change is reported), absent when it declares none. */
    readonly events?: { readonly subject?: unknown; readonly combine?: unknown; readonly members?: unknown } | undefined
    /** The type's fields by name, each with its kind (a `contact` kind makes a person-keyed subject). */
    readonly fields: Readonly<Record<string, { readonly kind: string }>>
}

/** True for the combine every trigger has when it declares none (the SDK's default): a declaration need not state it. */
export const isDefaultCombine = (combine: TriggerCombine): boolean => combine === DEFAULT_TRIGGER_COMBINE

/** The combine a type declares, else `each` (a type whose declaration the SDK did not check yet: the safe mode). */
export const combineOf = (source: RecordEventsSource): TriggerCombine =>
    isTriggerCombine(source.events?.combine) ? source.events.combine : DEFAULT_TRIGGER_COMBINE

/** True when the type's declared subject is a contact field: its events are about a person. */
export const personKeyed = (source: RecordEventsSource): boolean => {
    const subject = source.events?.subject
    return typeof subject === "string" && subject !== "id" && source.fields[subject]?.kind === "contact"
}
