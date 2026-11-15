import { Test } from "@nestjs/testing"
import { builder, fakeIds, fakeTransaction, FakeClock, mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { advisoryLockAnswers } from "@tests/fixtures/builders/advisory-lock.builder"
import { queueQueryBuilders } from "@tests/fixtures/builders/entity-query-builder-fake.builder"
import { CLOCK } from "@modules/platform/clock"
import { Secret } from "@modules/platform/config"
import { IDS } from "@modules/platform/ids"
import { QUEUE_OUTBOX, type QueueOutbox } from "@modules/platform/queue"
import { RECORD_EVENTS_QUEUE, RecordEventsJob } from "@modules/queues/record-events"
import type { EntityDefinition } from "@nivo-lite/agent-sdk/entity"
import type { Mutation } from "@nivo-lite/agent-sdk/mutation"
import { EngineFailureService } from "./engine-failure.service"
import { ENTITY_ENGINE_OPTIONS } from "./entity-engine.decorators"
import type { EntityEngineOptions } from "./entity-engine.options"
import { EntityEngineService } from "./entity-engine.service"
import { EntityMutationService } from "./entity-mutation.service"
import { EntityEngineError, EntityEngineErrorCode } from "./errors/entity-engine.error"
import { RecordEntity } from "./persistence/entities"
import { mintScopedTx } from "./policies/scoped-tx.policy"

/*
 * Concept agent-data rule 2 (E-STREAM S2): a write of a type that DECLARES `events` writes ONE queue outbox row in the write's own
 * transaction; a type that declares none writes nothing. The S1 members ride beside the plain definition (`Object.assign`).
 */

const WS = "11111111-1111-4111-8111-111111111111"
const AGENT_ID = "44444444-4444-4444-8444-444444444444"
const ORDER_ID = "33333333-3333-4333-8333-333333333333"
const NEW_ID = "00000000-0000-4000-8000-000000000001"
const RUN_ID = "66666666-6666-4666-8666-666666666666"
const SERVICE_ID = "55555555-5555-4555-8555-555555555555"
const AT = new Date("2026-11-15T03:00:00.000Z")

/** The case: overwritten state, keyed by the record itself, its status carried for a `where`. */
const ORDER: EntityDefinition = Object.assign<EntityDefinition, object>(
    {
        entry: "entity",
        name: "blocks-core.sales.order",
        dataKind: "sales-order",
        deletable: true,
        fields: {
            code: { kind: "text", nullable: false, maxLength: 20 },
            status: { kind: "enum", nullable: false, of: ["confirmed", "paid", "cancelled"] },
            customer: { kind: "contact", nullable: true },
        },
        matchKeys: [{ name: "byCode", on: ["code"] }],
    },
    { events: { subject: "id", combine: "latest", members: ["status"] } },
)
/** A second kind: facts about a service (no person), keyed by the service id. */
const REQUEST: EntityDefinition = Object.assign<EntityDefinition, object>(
    {
        entry: "entity",
        name: "fixture-web.webrenew.request",
        dataKind: "renew-request",
        fields: { serviceId: { kind: "uuid", nullable: false }, state: { kind: "enum", nullable: false, of: ["asked", "renewed"] } },
    },
    { events: { subject: "serviceId", combine: "each", members: ["state"] } },
)
/** A type that declares no events: its writes are no events. */
const NOTE: EntityDefinition = {
    entry: "entity",
    name: "blocks-core.sales.note",
    dataKind: "sales-note",
    fields: { text: { kind: "text", nullable: false, maxLength: 100 } },
}
const ENTITIES = [ORDER, REQUEST, NOTE]

const rawRecord = (id: string, data: Record<string, unknown>, version = "1") => ({
    id,
    workspace_id: WS,
    version,
    created_at: AT,
    updated_at: AT,
    data,
})

/** A failure mapper that throws, as the engine's does: a statement the fakes do not answer fails the call loudly. */
const failing = (): EngineFailureService => {
    const failures = mock<EngineFailureService>()
    failures.fail.mockImplementation(() => {
        throw new EntityEngineError({ code: EntityEngineErrorCode.Failed })
    })
    return failures
}

const build = async (em: MockEntityManager, withOutbox = true) => {
    fakeTransaction(em)
    const engine = mock<EntityEngineService>({ catalog: new Map(ENTITIES.map((entity) => [entity.name, entity])) })
    engine.definition.mockImplementation((name) => ENTITIES.find((entity) => entity.name === name) ?? NOTE)
    const outbox = mock<QueueOutbox>()
    outbox.write.mockResolvedValue(undefined)
    const moduleRef = await Test.createTestingModule({
        providers: [
            EntityMutationService,
            { provide: EntityEngineService, useValue: engine },
            { provide: EngineFailureService, useValue: failing() },
            {
                provide: ENTITY_ENGINE_OPTIONS,
                useValue: builder<EntityEngineOptions>({ entities: ENTITIES, jobs: [], cursorKey: new Secret("a2V5") })(),
            },
            { provide: CLOCK, useValue: new FakeClock(AT) },
            { provide: IDS, useValue: fakeIds() },
            ...(withOutbox ? [{ provide: QUEUE_OUTBOX, useValue: outbox }] : []),
        ],
    }).compile()
    return { mutations: moduleRef.get(EntityMutationService), outbox }
}

const txOf = (manager: MockEntityManager, writerRunId?: string) =>
    mintScopedTx({ manager, workspaceId: WS, agent: { id: AGENT_ID, sees: "own", ...(writerRunId === undefined ? {} : { writerRunId }) } })

const storedOrder = Object.assign(new RecordEntity(), {
    entity: ORDER.name,
    id: ORDER_ID,
    workspaceId: WS,
    version: "3",
    createdAt: AT,
    updatedAt: AT,
    data: { code: "DH-1", status: "confirmed" },
})

describe("EntityMutationService: a write of a type that declares events is ONE outbox row in the write's transaction", () => {
    it("an insert by a step names its run, the subject (the record itself) and the declared status (the case)", async () => {
        const em = mockEntityManager()
        const { mutations, outbox } = await build(em)
        queueQueryBuilders(em, [{ execute: { raw: [rawRecord(NEW_ID, { code: "DH-1", status: "confirmed" })] } }])

        await mutations.mutate(txOf(em, RUN_ID), { op: "insert", entity: ORDER.name, values: { code: "DH-1", status: "confirmed" } }, "action")

        expect(outbox.write).toHaveBeenCalledTimes(1)
        expect(outbox.write).toHaveBeenCalledWith(
            em,
            RECORD_EVENTS_QUEUE,
            {
                workspaceId: WS,
                agentId: AGENT_ID,
                type: ORDER.name,
                recordId: NEW_ID,
                version: "1",
                op: "created",
                writer: "run",
                writerRunId: RUN_ID,
                subject: NEW_ID,
                contactId: null,
                fields: { status: "confirmed" },
            },
            { job: RecordEventsJob.Deliver, dedupeKey: `record-event:${ORDER.name}:${NEW_ID}:v1` },
        )
    })

    it("an update by a person's action (no run) is `changed` at its new version, carrying the new status", async () => {
        const em = mockEntityManager()
        const { mutations, outbox } = await build(em)
        queueQueryBuilders(em, [{ execute: { raw: [rawRecord(ORDER_ID, { code: "DH-1", status: "cancelled" }, "4")] } }])
        const cancel: Mutation = { op: "update", entity: ORDER.name, key: ORDER_ID, expected: "3", values: { status: "cancelled" } }

        await mutations.mutate(txOf(em), cancel, "action")

        expect(outbox.write.mock.calls[0]?.[2]).toMatchObject({ op: "changed", version: "4", writer: "action", writerRunId: null, fields: { status: "cancelled" } })
    })

    it("a soft delete by a job is `deleted` at the version the delete bumps to", async () => {
        const em = mockEntityManager({ findOne: [RecordEntity, storedOrder] })
        const { mutations, outbox } = await build(em)
        queueQueryBuilders(em, [{ execute: { raw: [{ id: ORDER_ID }] } }])

        await mutations.mutate(txOf(em), { op: "delete", entity: ORDER.name, key: ORDER_ID }, "job")

        expect(outbox.write.mock.calls[0]?.[2]).toMatchObject({ op: "deleted", version: "4", writer: "job", recordId: ORDER_ID })
    })

    it("a second kind (facts about a service, no person) is keyed by the declared subject's value", async () => {
        const em = mockEntityManager()
        const { mutations, outbox } = await build(em)
        queueQueryBuilders(em, [{ execute: { raw: [rawRecord(NEW_ID, { serviceId: SERVICE_ID, state: "asked" })] } }])

        await mutations.mutate(txOf(em), { op: "insert", entity: REQUEST.name, values: { serviceId: SERVICE_ID, state: "asked" } }, "job")

        expect(outbox.write.mock.calls[0]?.[2]).toMatchObject({ subject: SERVICE_ID, contactId: null, fields: { state: "asked" }, writer: "job" })
    })

    it("an ensure that found its record wrote nothing, so it is no event; a type with no events is none either", async () => {
        // An ensure takes its match key's lock first.
        const em = mockEntityManager({ query: advisoryLockAnswers })
        const { mutations, outbox } = await build(em)
        queueQueryBuilders(em, [{ getOne: storedOrder }, { execute: { raw: [rawRecord(NEW_ID, { text: "x" })] } }])

        await mutations.mutate(txOf(em), { op: "ensure", entity: ORDER.name, match: "byCode", values: { code: "DH-1", status: "confirmed" } }, "job")
        await mutations.mutate(txOf(em), { op: "insert", entity: NOTE.name, values: { text: "x" } }, "job")

        expect(outbox.write).not.toHaveBeenCalled()
    })

    it("refuses a write of a type that declares events when no outbox is bound, rather than lose its event", async () => {
        const em = mockEntityManager()
        const { mutations } = await build(em, false)
        queueQueryBuilders(em, [{ execute: { raw: [rawRecord(NEW_ID, { code: "DH-1", status: "confirmed" })] } }])

        await expect(
            mutations.mutate(txOf(em), { op: "insert", entity: ORDER.name, values: { code: "DH-1", status: "confirmed" } }, "job"),
        ).rejects.toMatchObject({ code: EntityEngineErrorCode.PortUnprovided })
    })
})
