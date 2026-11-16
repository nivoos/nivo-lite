import { mock } from "@starci/jest-preset"
import type { EntityDefinition } from "@nivo-lite/agent-sdk/entity"
import type { EntitiesApi, RecordRow } from "@nivo-lite/agent-sdk/entity/port"
import { StreamCursorService } from "@modules/domain/customer-routes"
import { EntityEngineService, EntityPortsService } from "@modules/domain/entity-engine"
import type { NativeCaller } from "@modules/domain/tools"
import { MemoryStreamCursorStore } from "@tests/fixtures/builders/customer-routes-stores.builder"
import { RecordNativeService } from "./record-native.service"

/*
 * Concept agent-data rules 5, 8 (E-STREAM S3): the records of an append-only type are a STREAM; `nivo.tool.record.list` with `consume: true`
 * is the same consuming read as the thread read of a route: each fact answers its `seq`, the answer names the caller AGENT's `consumedSeq`
 * on the subject the `where` fixes, and the read is pending until the step ends. A second kind (facts about a service, no person).
 */

const WS = "ws-1"
const SERVICE = "55555555-5555-4555-8555-555555555555"
const NOTE: EntityDefinition = Object.assign<EntityDefinition, object>(
    {
        entry: "entity",
        name: "fixture-web.webrenew.renewal-note",
        dataKind: "renewal-note",
        fields: { serviceId: { kind: "uuid", nullable: false }, text: { kind: "text", nullable: false, maxLength: 400 } },
        indexes: [{ name: "service_recent", on: ["serviceId", { desc: "createdAt" }, { desc: "id" }] }],
    },
    { append: true, events: { subject: "serviceId", combine: "stream" } },
)
const PLAIN: EntityDefinition = {
    entry: "entity",
    name: "fixture-web.webrenew.note",
    dataKind: "note",
    fields: { serviceId: { kind: "uuid", nullable: false } },
    indexes: [{ name: "service_recent", on: ["serviceId", { desc: "createdAt" }, { desc: "id" }] }],
}

const rowOf = (id: string): RecordRow => ({ id, workspaceId: WS, version: "1", createdAt: "2026-11-15T03:00:00.000Z", updatedAt: "2026-11-15T03:00:00.000Z", data: { serviceId: SERVICE } })

const build = () => {
    const engine = mock<EntityEngineService>({ catalog: new Map([NOTE, PLAIN].map((one) => [one.name, one])) as never })
    engine.scoped.mockImplementation((_ws, work) => work(mock()))
    engine.seqsOf.mockResolvedValue(new Map([["n-1", "40"], ["n-2", "41"]]))
    const ports = mock<EntityPortsService>()
    ports.entitiesApi.mockReturnValue(mock<EntitiesApi>({ list: jest.fn().mockResolvedValue({ rows: [{ row: rowOf("n-2") }, { row: rowOf("n-1") }], next: null }) }))
    const store = new MemoryStreamCursorStore()
    const cursor = new StreamCursorService(store)
    return { tool: new RecordNativeService(engine, ports, cursor), cursor, store }
}

const STEP: NativeCaller = mock<NativeCaller>({ agentId: "agent-renew", conversationId: null, graphStep: true, opKey: "run-1:review:d1" })
const AS_CONTEXT: NativeCaller = mock<NativeCaller>({ agentId: "agent-renew", conversationId: null })
const ONE_SERVICE = { op: "eq", field: "serviceId", value: SERVICE }

describe("nivo.tool.record.list on an append-only type: the consuming read of a records stream", () => {
    it("answers each fact's position and the agent's position, notes a step's consuming read until the step ends", async () => {
        const { tool, cursor } = build()

        await expect(tool.invoke(WS, "list", { type: NOTE.name, where: ONE_SERVICE, consume: true }, STEP)).resolves.toMatchObject({
            records: [{ id: "n-2", seq: "41" }, { id: "n-1", seq: "40" }],
            consumedSeq: null,
        })
        await cursor.stepEnded(WS, "run-1", "review")
        await expect(tool.invoke(WS, "list", { type: NOTE.name, where: ONE_SERVICE }, AS_CONTEXT)).resolves.toMatchObject({ consumedSeq: "41" })
        // Another agent reading the same service keeps its own position (reads are open across agents).
        await expect(
            tool.invoke(WS, "list", { type: NOTE.name, where: ONE_SERVICE }, mock<NativeCaller>({ agentId: "agent-books", conversationId: null })),
        ).resolves.toMatchObject({ consumedSeq: null })
    })

    it("a read for context (no `consume`) consumes nothing, and a stop of the step (no end) leaves the facts unread for its re-run", async () => {
        const { tool, store } = build()

        await tool.invoke(WS, "list", { type: NOTE.name, where: ONE_SERVICE }, STEP)
        expect(store.rows.size).toBe(0)
        await tool.invoke(WS, "list", { type: NOTE.name, where: ONE_SERVICE, consume: true }, STEP)
        expect(await tool.invoke(WS, "list", { type: NOTE.name, where: ONE_SERVICE }, AS_CONTEXT)).toMatchObject({ consumedSeq: null })
    })

    it("refuses a consuming read of a type that is no stream, or one that fixes no subject (`query_invalid`)", async () => {
        const { tool } = build()

        await expect(tool.invoke(WS, "list", { type: PLAIN.name, where: ONE_SERVICE, consume: true }, STEP)).rejects.toMatchObject({
            params: { reason: "query_invalid" },
        })
        await expect(tool.invoke(WS, "list", { type: NOTE.name, consume: true }, STEP)).rejects.toMatchObject({ params: { reason: "query_invalid" } })
    })

    it("answers a type that is no stream as before: no positions", async () => {
        const { tool } = build()

        const answered = await tool.invoke(WS, "list", { type: PLAIN.name, where: ONE_SERVICE }, AS_CONTEXT)
        expect(answered).not.toHaveProperty("consumedSeq")
    })
})
