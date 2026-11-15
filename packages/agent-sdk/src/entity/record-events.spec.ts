import { defineEntity, field } from "./entity"
import type { EntityConfig, FieldMap } from "./entity.types"
import { entitiesDdlOf } from "./render-fresh"
import { manifestOf } from "./manifest"

/*
 * Concept agent-data rules 2, 3, 5 (E-STREAM S1): a record type DECLARES what its writes are as events (subject, combine, members) and
 * whether it is an append-only stream. The declaration is checked at module load; it changes no table, index or check of the type.
 */

const thrown = (make: () => unknown): unknown => {
    try {
        make()
    } catch (error) {
        return error
    }
    return null
}

/** The codes a declaration is refused with (the config is loose on purpose: a refused shape is the point of the call). */
const codesOf = (config: object): ReadonlyArray<string> => {
    const error = thrown(() => defineEntity(config as EntityConfig<FieldMap>)) as { problems?: ReadonlyArray<{ code: string }> } | null
    return (error?.problems ?? []).map((problem) => problem.code)
}

const orderFields = {
    code: field.text({ maxLength: 20 }),
    customer: field.contact({ nullable: true }),
    status: field.enum({ of: ["confirmed", "paid", "cancelled"] }),
}

/** Overwritten state, keyed by the record itself: the case (a cancel must reach the run waiting on the order). */
const order = defineEntity({
    name: "blocks-core.sales.order",
    dataKind: "sales-order",
    fields: { code: field.text({ maxLength: 20 }), customer: field.contact({ nullable: true }), status: orderFields.status },
    events: { subject: "id", combine: "latest", members: ["status"] },
})

/** A second kind: append-only facts about a service (no person), a stream split by the service id. */
const note = defineEntity({
    name: "fixture-web.webrenew.renewal-note",
    dataKind: "renewal-note",
    fields: { serviceId: field.uuid(), text: field.text({ maxLength: 400 }), kind: field.enum({ of: ["asked", "renewed", "failed"] }) },
    append: true,
    events: { subject: "serviceId", combine: "stream", members: ["kind"] },
})

describe("record write events and streams: the declaration", () => {
    it("takes an overwritten-state type keyed by itself and an append-only stream keyed by a field that is no person", () => {
        expect(order.events).toEqual({ subject: "id", combine: "latest", members: ["status"] })
        expect(note.append).toBe(true)
        expect(note.events?.subject).toBe("serviceId")
    })

    it("keeps the events declaration frozen", () => {
        expect(Object.isFrozen(order.events)).toBe(true)
        expect(Object.isFrozen(order.events?.members)).toBe(true)
    })

    it("takes a contact field as the subject (the events are then keyed by the person)", () => {
        expect(
            codesOf({
                name: "blocks-core.sales.claim",
                dataKind: "claim",
                fields: { person: field.contact(), amount: field.int() },
                events: { subject: "person", combine: "each" },
            }),
        ).toEqual([])
    })

    it("refuses a subject that is not `id` or a declared scalar field", () => {
        const base = { name: "blocks-core.sales.bad", dataKind: "bad", fields: { status: orderFields.status, note: field.text({ maxLength: 4 }) } }
        expect(codesOf({ ...base, events: { subject: "ghost", combine: "each" } })).toEqual(["ENTITY_EVENTS_SUBJECT_INVALID"])
        expect(
            codesOf({
                name: "blocks-core.sales.bad",
                dataKind: "bad",
                fields: { flag: field.bool() },
                events: { subject: "flag", combine: "each" },
            }),
        ).toEqual(["ENTITY_EVENTS_SUBJECT_INVALID"])
        expect(codesOf({ ...base, events: { subject: "note", combine: "each" } })).toEqual([])
    })

    it("refuses a combine that is none of the three modes", () => {
        const config = {
            name: "blocks-core.sales.bad",
            dataKind: "bad",
            fields: { status: orderFields.status },
            events: { subject: "id", combine: "merge" as never },
        }
        expect(codesOf(config)).toEqual(["ENTITY_EVENTS_COMBINE_INVALID"])
    })

    it("refuses a member that is no declared enum field, or one named twice", () => {
        const base = { name: "blocks-core.sales.bad", dataKind: "bad", fields: { status: orderFields.status, code: orderFields.code } }
        expect(codesOf({ ...base, events: { subject: "id", combine: "latest", members: ["code"] } })).toEqual([
            "ENTITY_EVENTS_MEMBER_INVALID",
        ])
        expect(codesOf({ ...base, events: { subject: "id", combine: "latest", members: ["ghost"] } })).toEqual([
            "ENTITY_EVENTS_MEMBER_INVALID",
        ])
        expect(codesOf({ ...base, events: { subject: "id", combine: "latest", members: ["status", "status"] } })).toEqual([
            "ENTITY_EVENTS_MEMBER_INVALID",
        ])
    })

    it("allows `stream` only on a type declared append", () => {
        expect(
            codesOf({
                name: "blocks-core.sales.bad",
                dataKind: "bad",
                fields: { status: orderFields.status },
                events: { subject: "id", combine: "stream" },
            }),
        ).toEqual(["ENTITY_EVENTS_STREAM_NOT_APPEND"])
    })

    it("refuses an append type with no events (no subject splits its stream) or with states (its rows never change)", () => {
        const fields = { status: orderFields.status }
        expect(codesOf({ name: "blocks-core.sales.bad", dataKind: "bad", fields, append: true })).toEqual(["ENTITY_APPEND_INVALID"])
        expect(
            codesOf({
                name: "blocks-core.sales.bad",
                dataKind: "bad",
                fields,
                append: true,
                events: { subject: "id", combine: "each" },
                states: { field: "status", transitions: { confirmed: ["paid"] } },
            }),
        ).toEqual(["ENTITY_APPEND_INVALID"])
    })

    it("changes no partition, check or index of the type (no DDL or manifest drift from declaring events)", () => {
        const plain = defineEntity({
            name: "fixture-web.webrenew.renewal-note",
            dataKind: "renewal-note",
            fields: { serviceId: field.uuid(), text: field.text({ maxLength: 400 }), kind: field.enum({ of: ["asked", "renewed", "failed"] }) },
        })
        expect(entitiesDdlOf([note])).toBe(entitiesDdlOf([plain]))
        expect(manifestOf([note])).toEqual(manifestOf([plain]))
    })
})
