import { TRIGGER } from "@nivo-lite/agent-sdk/names"
import {
    isWaitPayload,
    parkOfWaitQuestion,
    runSubjectOf,
    timeoutMsOf,
    waitCameOf,
    waitOnOf,
    waitOutputOf,
    waitParkOf,
    waitTakes,
} from "./thread-waits.policy"

// The pure half of `wait` on a thread: which event a parked wait takes (verb, `where`, the run's subject or the wait's match), the park
// read back from the checkpoint, and the output of what came.
const on = waitOnOf([
    {
        key: "paid",
        verbs: [TRIGGER.paymentCreditReceived],
        match: [{ member: "content", op: "contains", value: "dh a12", caseFold: true }],
    },
    { key: "replied", verbs: [TRIGGER.zaloMessageReceived], where: [{ param: "text", op: "present" }] },
])

const park = waitParkOf("hold", "2026-11-13T05:00:00.000Z", on ?? [], runSubjectOf(on ?? [], { conversationId: "c-1", contactId: "p-1", noteId: "n" }))

describe("waitTakes", () => {
    it("a credit is taken by its match (no subject join), folded case", () => {
        expect(waitTakes(park, TRIGGER.paymentCreditReceived, { transactionId: "t-9", content: "CK DH A12" })).toBe("paid")
        expect(waitTakes(park, TRIGGER.paymentCreditReceived, { transactionId: "t-9", content: "CK DH A13" })).toBeNull()
    })

    it("a line is taken by the run's subject (the same conversation or contact) and its `where`", () => {
        expect(waitTakes(park, TRIGGER.zaloMessageReceived, { conversationId: "c-1", text: "ok" })).toBe("replied")
        expect(waitTakes(park, TRIGGER.zaloMessageReceived, { conversationId: "c-2", contactId: "p-1", text: "ok" })).toBe("replied")
        expect(waitTakes(park, TRIGGER.zaloMessageReceived, { conversationId: "c-2", text: "ok" })).toBeNull()
        expect(waitTakes(park, TRIGGER.zaloMessageReceived, { conversationId: "c-1", text: "" })).toBeNull()
    })

    it("a verb the wait does not list is never taken", () => {
        expect(waitTakes(park, TRIGGER.telegramMessageReceived, { conversationId: "c-1", text: "ok" })).toBeNull()
    })
})

// Concept templates rule 12 (S7-WAIT): a KEY is one meaning listing the verbs that bring it; the park keeps one entry per (key, verb), and a
// wake is taken by the key whose verb list holds its verb. The case: a person's line on any channel; the second kind: a record write of a
// type keyed by the record (no person), matched on its id.
describe("a key listing several verbs", () => {
    const keys = waitOnOf([
        { key: "said", verbs: [TRIGGER.zaloMessageReceived, TRIGGER.telegramMessageReceived, TRIGGER.facebookMessageReceived] },
        {
            key: "ordered",
            verbs: [TRIGGER.recordWritten],
            where: [{ param: "data.type", op: "equals", value: "blocks-core.sales.order" }],
            match: [{ member: "data.recordId", op: "eq", value: "order-1" }],
        },
    ])
    const parked = waitParkOf("pay", "2026-11-15T05:00:00.000Z", keys ?? [], runSubjectOf(keys ?? [], { conversationId: "c-1", contactId: "p-1" }))

    it("parks one entry per verb under its key, the key's where and match on each, in written order", () => {
        expect(keys?.map((one) => `${one.key}:${one.verb}`)).toEqual([
            `said:${TRIGGER.zaloMessageReceived}`,
            `said:${TRIGGER.telegramMessageReceived}`,
            `said:${TRIGGER.facebookMessageReceived}`,
            `ordered:${TRIGGER.recordWritten}`,
        ])
        expect(parkOfWaitQuestion({ ...parked, on: parked.on.map((one) => ({ ...one })) })).toEqual(parked)
    })

    it("the case: a line of the run's person on ANY listed channel is taken under the one key; an unlisted channel is not", () => {
        for (const verb of [TRIGGER.zaloMessageReceived, TRIGGER.telegramMessageReceived, TRIGGER.facebookMessageReceived])
            expect(waitTakes(parked, verb, { conversationId: "c-1", text: "don toi sao roi" })).toBe("said")
        expect(waitTakes(parked, TRIGGER.instagramMessageReceived, { conversationId: "c-1", text: "x" })).toBeNull()
        expect(waitTakes(parked, TRIGGER.telegramMessageReceived, { conversationId: "c-9", text: "x" })).toBeNull()
    })

    it("the second kind: a write of the order's record (no person) is taken by its id under `ordered`; another type or record is not", () => {
        const written = (type: string, recordId: string) => ({ data: { type, recordId, op: "changed", subject: recordId, fields: { status: "cancelled" } } })
        expect(waitTakes(parked, TRIGGER.recordWritten, written("blocks-core.sales.order", "order-1"))).toBe("ordered")
        expect(waitTakes(parked, TRIGGER.recordWritten, written("blocks-core.sales.order", "order-2"))).toBeNull()
        expect(waitTakes(parked, TRIGGER.recordWritten, written("blocks-core.sales.lead", "order-1"))).toBeNull()
    })

    it("the stored params are refused when a key lists no verb or a verb that is no text", () => {
        expect(waitOnOf([{ key: "said", verbs: [] }])).toBeNull()
        expect(waitOnOf([{ key: "said", verbs: [TRIGGER.zaloMessageReceived, 7] }])).toBeNull()
        expect(waitOnOf([{ key: "said" }])).toBeNull()
    })

    it("a stored wait that still holds a single `verb` is refused, never read (no legacy reader: migrations 000400 and 000403 move every stored document)", () => {
        expect(waitOnOf([{ key: "said", verb: TRIGGER.zaloMessageReceived }])).toBeNull()
        expect(waitOnOf([{ key: "said", verbs: [TRIGGER.zaloMessageReceived] }])).not.toBeNull()
    })
})

describe("the park and what came", () => {
    it("keeps the run's subject members only, and reads back from the checkpoint as written", () => {
        expect(park.subject).toEqual({ conversationId: "c-1", contactId: "p-1" })
        expect(parkOfWaitQuestion(JSON.parse(JSON.stringify(park)))).toEqual(park)
        expect(parkOfWaitQuestion({ kind: "until_round" })).toBeNull()
    })

    it("answers the key and the event, or the timeout; a resume value of another park is no answer", () => {
        expect(waitOutputOf({ key: "replied", event: { text: "ok" } })).toEqual({ trigger: "replied", event: { text: "ok" } })
        expect(waitOutputOf({ timeout: true })).toEqual({ trigger: "timeout" })
        expect(waitCameOf({ kind: "wait", parkKey: "hold", came: { timeout: true } }, "hold")).toEqual({ timeout: true })
        expect(waitCameOf({ kind: "wait", parkKey: "other", came: { timeout: true } }, "hold")).toBeNull()
    })

    it("reads one unit of timeout, and marks its deadline apart from a stop's and a round's", () => {
        expect([timeoutMsOf({ minutes: 30 }), timeoutMsOf({ hours: 2 }), timeoutMsOf({ minutes: 1, hours: 1 })]).toEqual([
            1_800_000,
            7_200_000,
            null,
        ])
        expect([isWaitPayload({ answered: -2 }), isWaitPayload({ answered: -1 }), isWaitPayload({ answered: 0 })]).toEqual([
            true,
            false,
            false,
        ])
    })
})
