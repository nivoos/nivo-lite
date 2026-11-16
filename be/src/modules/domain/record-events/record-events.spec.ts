import { Test } from "@nestjs/testing"
import { mock, mockEntityManager, fakeTransaction } from "@starci/jest-preset"
import { TRIGGER } from "@nivo-lite/agent-sdk/names"
import { AgentRunsService } from "@modules/domain/agent-runs"
import { EntityEngineService } from "@modules/domain/entity-engine"
import { ProviderTriggersService, keyPathOf, triggerDeclarations, type DeliverResult } from "@modules/domain/provider-triggers"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import type { RecordEventPayload } from "@modules/queues/record-events"
import { RecordEventDeliveryService } from "./record-event-delivery.service"
import { RECORD_SUBJECT_PATH, recordWrittenDeclarationOf, type RecordEventsSource } from "./record-written.trigger"

/*
 * Concept agent-data rules 2, 3, 4, 7 (E-STREAM S2): a record type that declares `events` gets ONE derived trigger declaration; a write's
 * outbox row is delivered to the agent that owns the record, naming the writing run and its workflow; a record no longer live is
 * delivered only as its deletion.
 */

const WS = "ws-1"
const OWNER = "agent-sales"
const RUN = "run-7"

const ORDER: RecordEventsSource = {
    name: "blocks-core.sales.order",
    fields: { status: { kind: "enum" }, customer: { kind: "contact" } },
    events: { subject: "id", combine: "latest", members: ["status"] },
}
const CLAIM: RecordEventsSource = {
    name: "blocks-core.sales.claim",
    fields: { person: { kind: "contact" } },
    events: { subject: "person", combine: "each" },
}
const NOTE: RecordEventsSource = {
    name: "fixture-web.webrenew.renewal-note",
    fields: { serviceId: { kind: "uuid" } },
    append: true,
    events: { subject: "serviceId", combine: "stream" },
}

const payloadOf = (over: Partial<RecordEventPayload> = {}): RecordEventPayload => ({
    workspaceId: WS,
    agentId: OWNER,
    type: ORDER.name,
    recordId: "order-1",
    version: "4",
    op: "changed",
    writer: "action",
    writerRunId: null,
    subject: "order-1",
    contactId: null,
    fields: { status: "cancelled" },
    ...over,
})

describe("the derived declaration of a record type's write events", () => {
    it("is the record write verb, received internally, keyed by the record itself, combined as the type declares (the case)", () => {
        const declaration = recordWrittenDeclarationOf(ORDER)
        expect([declaration.provider, declaration.name, declaration.verb, declaration.via, declaration.key, declaration.combine]).toEqual([
            "nivo",
            "record.written:blocks-core.sales.order",
            TRIGGER.recordWritten,
            ["internal"],
            { by: "data", member: "subject" },
            "latest",
        ])
        expect(declaration.withoutPoll?.source).toBe("nivo:record-event.deliver")
        expect(declaration.feeds).toBeUndefined()
        // The same object every time: registering it twice is a no-op.
        expect(recordWrittenDeclarationOf(ORDER)).toBe(declaration)
        expect(() => triggerDeclarations.register(declaration, declaration)).not.toThrow()
    })

    it("is keyed by the PERSON only when the declared subject is a contact field", () => {
        expect(recordWrittenDeclarationOf(CLAIM).key).toEqual({ by: "contact" })
        expect(recordWrittenDeclarationOf(CLAIM).combine).toBeUndefined()
    })

    it("feeds the records stream of an append-only type (a second kind: no person) and may combine as a stream", () => {
        const declaration = recordWrittenDeclarationOf(NOTE)
        expect(declaration.feeds).toEqual({ stream: "records", type: NOTE.name })
        expect(declaration.key).toEqual({ by: "data", member: "subject" })
        expect(() => triggerDeclarations.register(declaration)).not.toThrow()
    })

    it("names the subject path the erase ends runs by: the one the pipeline keys a non-person subject with", () => {
        expect(keyPathOf({ by: "data", member: "subject" })).toBe(RECORD_SUBJECT_PATH)
    })

    it("translates a write into ids only, its id the write's own", () => {
        expect(recordWrittenDeclarationOf(ORDER).translate(payloadOf(), { connectionId: null })).toEqual({
            id: "blocks-core.sales.order:order-1:v4",
            data: { type: ORDER.name, recordId: "order-1", op: "changed", version: "4", writer: "action", subject: "order-1", fields: { status: "cancelled" } },
        })
    })
})

const build = async (live: boolean, workflowId: string | null = "wf-consult") => {
    const em = mockEntityManager()
    fakeTransaction(em)
    const triggers = mock<ProviderTriggersService>()
    const delivered: DeliverResult = { status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 }
    triggers.deliver.mockResolvedValue(delivered)
    const records = mock<EntityEngineService>({ catalog: new Map([ORDER, CLAIM, NOTE].map((one) => [one.name, one])) as never })
    records.scoped.mockImplementation((_ws, work) => work(mock()))
    records.get.mockResolvedValue(live ? ({ id: "order-1" } as never) : null)
    const runs = mock<AgentRunsService>()
    runs.runOf.mockResolvedValue({ id: RUN, context: workflowId === null ? {} : { workflowId } } as never)
    const moduleRef = await Test.createTestingModule({
        providers: [
            RecordEventDeliveryService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: ProviderTriggersService, useValue: triggers },
            { provide: EntityEngineService, useValue: records },
            { provide: AgentRunsService, useValue: runs },
        ],
    }).compile()
    return { delivery: moduleRef.get(RecordEventDeliveryService), triggers }
}

describe("RecordEventDeliveryService: a write enters the one pipeline for the agent that owns the record", () => {
    it("delivers a person's cancel to the owner with no writer (the case: the run parked on the order may take it)", async () => {
        const { delivery, triggers } = await build(true)

        await expect(delivery.deliver(payloadOf())).resolves.toMatchObject({ kind: "delivered" })
        const [input] = triggers.deliver.mock.calls[0] ?? []
        expect(input).toMatchObject({ workspaceId: WS, connectionId: null, agentId: OWNER })
        expect(input?.declaration).toBe(recordWrittenDeclarationOf(ORDER))
        expect(input?.events).toEqual([
            { event: expect.objectContaining({ id: "blocks-core.sales.order:order-1:v4" }), contactId: null, writer: null },
        ])
    })

    it("names the writing run and its workflow, so neither takes its own write back", async () => {
        const { delivery, triggers } = await build(true)

        await delivery.deliver(payloadOf({ writer: "run", writerRunId: RUN }))
        expect(triggers.deliver.mock.calls[0]?.[0].events[0]?.writer).toEqual({ runId: RUN, workflowId: "wf-consult" })
    })

    it("hands the person of a contact-keyed type (a second kind of subject)", async () => {
        const { delivery, triggers } = await build(true)

        await delivery.deliver(payloadOf({ type: CLAIM.name, recordId: "claim-1", subject: "contact-9", contactId: "contact-9", fields: {} }))
        expect(triggers.deliver.mock.calls[0]?.[0].events[0]?.contactId).toBe("contact-9")
    })

    it("delivers nothing for a record that is no longer live (an erased person's record), unless the event IS its deletion", async () => {
        const gone = await build(false)
        await expect(gone.delivery.deliver(payloadOf())).resolves.toEqual({ kind: "dropped", reason: "record_gone" })
        expect(gone.triggers.deliver).not.toHaveBeenCalled()

        await expect(gone.delivery.deliver(payloadOf({ op: "deleted", version: "5" }))).resolves.toMatchObject({ kind: "delivered" })
    })

    it("delivers nothing for a type that no longer declares events", async () => {
        const { delivery, triggers } = await build(true)

        await expect(delivery.deliver(payloadOf({ type: "blocks-core.sales.gone" }))).resolves.toEqual({ kind: "dropped", reason: "undeclared" })
        expect(triggers.deliver).not.toHaveBeenCalled()
    })
})
