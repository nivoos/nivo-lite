import { Test } from "@nestjs/testing"
import { mock, mockEntityManager } from "@starci/jest-preset"
import { agentWakeOf as wake, agentWakeRowOf } from "@tests/fixtures/builders/agent-work.builder"
import { queueQueryBuilders } from "@tests/fixtures/builders/entity-query-builder-fake.builder"
import type { QueryBuilderAnswers } from "@tests/fixtures/builders/entity-query-builder-fake.builder"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { AGENT_TURN_QUEUE_PRODUCER, AgentTurnQueue } from "@modules/queues/agent-turn"
import { jobRecordingOutbox } from "@tests/fixtures/builders/queue-job-outbox.builder"
import { AgentWakeService } from "./agent-wake.service"

const inserted = (...ids: Array<string>): QueryBuilderAnswers => ({ execute: { raw: ids.map((id) => ({ id })) } })

/** The wake door with a recording drain queue. */
const build = async (answer: QueryBuilderAnswers) => {
    const outbox = jobRecordingOutbox()
    const real = new AgentTurnQueue(outbox)
    const queue = mock<AgentTurnQueue>({ enqueueDrain: jest.fn(real.enqueueDrain.bind(real)) })
    const logger = mock<Logger>()
    const tx = mockEntityManager()
    const [fake] = queueQueryBuilders(tx, [answer])
    const container = await Test.createTestingModule({
        providers: [
            AgentWakeService,
            { provide: AGENT_TURN_QUEUE_PRODUCER, useValue: queue },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { service: container.get(AgentWakeService), queue, outbox, logger, tx, fake }
}

describe("AgentWakeService.wake", () => {
    it("writes a new fact once, with its priority, budget and scope, and starts its drain in the same transaction", async () => {
        const { service, queue, tx, fake } = await build(inserted("wake-1"))

        await expect(service.wake(tx, wake())).resolves.toBe(true)

        expect(fake?.callsOf("values")).toEqual([
            [
                {
                    workspaceId: "ws-1",
                    agentId: "agent-1",
                    source: "tag",
                    eventKey: "msg-1",
                    scopeKey: "agent",
                    priority: 20,
                    maxAttempts: 3,
                    background: false,
                    context: { messageId: "msg-1", room: "sales" },
                    burstWindowMs: null,
                    burstMaxMs: null,
                    actorMemberId: "member-1",
                },
            ],
        ])
        expect(fake?.callsOf("orIgnore")).toEqual([[]])
        expect(queue.enqueueDrain).toHaveBeenCalledWith(
            { workspaceId: "ws-1", agentId: "agent-1", scopeKey: "agent" },
            "tag",
            "msg-1",
            tx,
            0,
        )
    })
})

describe("AgentWakeService drain job", () => {
    const job = (scopeKey: string, dedupeKey: string, delayMs: number) => ({
        queue: "agent_turn",
        payload: { workspaceId: "ws-1", agentId: "agent-1", scopeKey },
        job: "agent-turn.drain",
        dedupeKey,
        delayMs,
    })

    // A channel line (the Zalo declaration settles 6 s, at most 20 s): the settle time rides on the wake `deliver` writes.
    const line = wake({ source: "trigger", eventKey: "zalo:1", scopeKey: "key:routeId=r-1", settle: { windowMs: 6000, maxWaitMs: 20_000 } })

    it("writes the drain job of a wake with a settle time once per fact, waiting its window", async () => {
        const { service, outbox, tx } = await build(inserted("wake-1"))

        await service.wake(tx, line)

        expect(outbox.written).toEqual([job("key:routeId=r-1", "agent-turn:agent-1:trigger:zalo:1", 6000)])
    })

    it("makes the drain of a wake held for the agent's next working hour wait until then, over the settle window", async () => {
        const { service, outbox, tx } = await build(inserted("wake-1"))

        await service.wake(tx, { ...line, delayMs: 3_600_000 })

        expect(outbox.written).toEqual([job("key:routeId=r-1", "agent-turn:agent-1:trigger:zalo:1", 3_600_000)])
    })

    it("writes the drain job of any other wake to run at once", async () => {
        const { service, outbox, tx } = await build(inserted("wake-1"))

        await service.wake(tx, wake({ source: "tag", eventKey: "evt-1" }))

        expect(outbox.written).toEqual([job("agent", "agent-turn:agent-1:tag:evt-1", 0)])
    })
})

describe("AgentWakeService settle time: the source's declaration, kept on the wake", () => {
    it("keeps the declared window and longest wait on the wake; a declaration with no longest wait waits no longer than its window", async () => {
        const capped = await build(inserted("wake-1"))
        const open = await build(inserted("wake-1"))

        await capped.service.wake(capped.tx, wake({ source: "trigger", settle: { windowMs: 6000, maxWaitMs: 20_000 } }))
        await open.service.wake(open.tx, wake({ source: "trigger", settle: { windowMs: 4000, maxWaitMs: null } }))

        expect(capped.fake?.callsOf("values")[0]?.[0]).toMatchObject({ burstWindowMs: 6000, burstMaxMs: 20_000 })
        expect(open.fake?.callsOf("values")[0]?.[0]).toMatchObject({ burstWindowMs: 4000, burstMaxMs: 4000 })
    })

    it("waits nothing for a wake with no settle time, whatever its scope", async () => {
        const { service, queue, tx, fake } = await build(inserted("wake-1"))

        await service.wake(tx, wake({ source: "trigger", scopeKey: "key:routeId=r-1" }))

        expect(fake?.callsOf("values")[0]?.[0]).toMatchObject({ burstWindowMs: null, burstMaxMs: null })
        expect(queue.enqueueDrain).toHaveBeenCalledWith(expect.anything(), "trigger", "msg-1", tx, 0)
    })
})

describe("AgentWakeService.write", () => {
    it("answers the id of the wake it wrote, and takes the scope an adapter asked for and the traits it declared", async () => {
        const { service, queue, tx, fake } = await build(inserted("wake-9"))

        await expect(
            service.write(tx, wake({ source: "tag", scopeKey: "order:o-1", eventKey: "evt-9" })),
        ).resolves.toBe("wake-9")

        expect(fake?.callsOf("values")[0]?.[0]).toMatchObject({
            scopeKey: "order:o-1",
            priority: 20,
            background: false,
        })
        expect(queue.enqueueDrain).toHaveBeenCalledWith(
            { workspaceId: "ws-1", agentId: "agent-1", scopeKey: "order:o-1" },
            "tag",
            "evt-9",
            tx,
            0,
        )
    })

    it("marks the wake of a background source so the day cap needs no name", async () => {
        const { service, tx, fake } = await build(inserted("wake-8"))

        await service.write(tx, wake({ source: "schedule" }))

        expect(fake?.callsOf("values")[0]?.[0]).toMatchObject({ background: true, priority: 40 })
    })

    it("refuses a wake of a source no adapter recorded", async () => {
        const { service, tx } = await build(inserted("wake-7"))

        await expect(service.write(tx, wake({ source: "nobody_registered" }))).rejects.toThrow()
    })

    it("answers null when the insert returns something that is not a row with an id", async () => {
        const { service, tx } = await build({ execute: { raw: [{ other: 1 }] } })

        await expect(service.write(tx, wake())).resolves.toBeNull()
    })

    it("writes nothing and enqueues nothing when the fact was already written", async () => {
        const { service, queue, logger, tx } = await build(inserted())

        await expect(service.wake(tx, wake())).resolves.toBe(false)

        expect(queue.enqueueDrain).not.toHaveBeenCalled()
        expect(logger.info).not.toHaveBeenCalled()
    })

    it("leaves the transaction to roll back when the job cannot be written", async () => {
        const { service, queue, tx } = await build(inserted("wake-3"))
        queue.enqueueDrain.mockRejectedValue(new Error("outbox down"))

        await expect(service.wake(tx, wake())).rejects.toThrow("outbox down")
    })
})

describe("AgentWakeService > absent insert receipts", () => {
    it("returns no wake id and enqueues no drain when the driver returns no row array", async () => {
        const { service, queue, logger, tx } = await build({ execute: { raw: null } })

        await expect(service.write(tx, wake())).resolves.toBeNull()

        expect(queue.enqueueDrain).not.toHaveBeenCalled()
        expect(logger.info).not.toHaveBeenCalled()
    })
})

// FX4 (D-P11-7): a held wake whose event a freeze wrote again as a new wake is closed with it, pointing at the replay.
describe("AgentWakeService.superseded", () => {
    it("closes only a wake still held, in the caller's transaction, as skipped with the reason naming its replay", async () => {
        const { service, tx } = await build(inserted("unused"))
        tx.update.mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] }).mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] })

        await expect(service.superseded(tx, "ws-1", "wake-held", "wake-replay")).resolves.toBe(true)
        await expect(service.superseded(tx, "ws-1", "wake-held", "wake-replay")).resolves.toBe(false)

        expect(tx.update).toHaveBeenCalledWith(
            expect.anything(),
            { id: "wake-held", workspaceId: "ws-1", status: "held" },
            { status: "skipped", reason: "replayed:wake-replay" },
        )
    })
})

describe("AgentWakeService.replaceOlder: rule Q-4 `latest` (QB-LATEST), the wake just written replaces the older un-run wakes of its set", () => {
    const set = { workspaceId: "ws-1", agentId: "agent-1", scopeKey: "key:data.taskId=t-1", declaration: "nivo:timer.due", workflowId: "wf-1" }
    const latest = (id: string, minute: number, extra: Record<string, string> = {}) =>
        agentWakeRowOf({
            id,
            scopeKey: set.scopeKey,
            status: id === "w-3" ? "pending" : "held",
            reason: id === "w-3" ? null : "waiting:run-1",
            createdAt: new Date(Date.UTC(2026, 10, 14, 10, minute)),
            context: { combine: "latest", declaration: set.declaration, workflowId: "wf-1", eventId: `e-${id}`, ...extra },
        })
    /** The door over a set read as `rows`: the lock statement and the newest's context write answer as the table does. */
    const door = async (rows: ReadonlyArray<ReturnType<typeof latest>>) => {
        const built = await build({ getMany: rows })
        built.tx.query.mockResolvedValue([])
        built.tx.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] })
        return built
    }

    it("reads the set under the scope's lock, closes the older ones `replaced:<newest>` and counts them on the newest", async () => {
        const { service, tx, fake, logger } = await door([latest("w-1", 0), latest("w-2", 1, { count: "2" }), latest("w-3", 2)])
        const [close] = queueQueryBuilders(tx, [{ execute: { affected: 2 } }])

        await expect(service.replaceOlder(tx, set, "w-3")).resolves.toBe(2)

        expect(tx.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext($1))", ["wake-stream:agent-1:key:data.taskId=t-1"])
        // The set: un-run (pending, or held behind a run), this mode, this declaration, this registration, never a handed-back wake.
        expect(fake?.callsOf("andWhere")).toEqual(
            expect.arrayContaining([
                ["(w.status = 'pending' OR (w.status = 'held' AND w.reason LIKE :waiting))", { waiting: "waiting:%" }],
                ["w.context ->> 'combine' = :latest", { latest: "latest" }],
                ["w.context ->> 'declaration' = :declaration", { declaration: "nivo:timer.due" }],
                ["COALESCE(w.context ->> 'workflowId', '') = :workflowId", { workflowId: "wf-1" }],
                ["w.context ->> 'handedBackJson' IS NULL"],
            ]),
        )
        expect(fake?.callsOf("setLock")).toEqual([["pessimistic_write"]])
        expect(close?.callsOf("set")).toEqual([[{ status: "skipped", reason: "replaced:w-3", finishedAt: expect.any(Function) }]])
        expect(close?.callsOf("where")).toEqual([
            ["workspace_id = :workspaceId AND status IN ('pending', 'held') AND id IN (:...ids)", { workspaceId: "ws-1", ids: ["w-1", "w-2"] }],
        ])
        // The newest keeps its own event and stands for 1 + 1 + 2 events.
        expect(tx.update).toHaveBeenCalledWith(expect.anything(), { workspaceId: "ws-1", id: "w-3" }, {
            context: { combine: "latest", declaration: "nivo:timer.due", workflowId: "wf-1", eventId: "e-w-3", count: "4" },
        })
        expect(logger.info).toHaveBeenCalledWith("agent_work.wake_replaced", expect.objectContaining({ kept: "w-3", replaced: 2, count: "4" }))
    })

    it("a set of one replaces nothing and writes nothing", async () => {
        const { service, tx } = await door([latest("w-3", 2)])

        await expect(service.replaceOlder(tx, set, "w-3")).resolves.toBe(0)

        expect(tx.createQueryBuilder).toHaveBeenCalledTimes(1)
        expect(tx.update).not.toHaveBeenCalled()
    })

    it("the newest no longer in the set (begun or closed meanwhile) decides nothing: the older ones stay", async () => {
        const { service, tx } = await door([latest("w-1", 0), latest("w-2", 1)])

        await expect(service.replaceOlder(tx, set, "w-3")).resolves.toBe(0)

        expect(tx.createQueryBuilder).toHaveBeenCalledTimes(1)
        expect(tx.update).not.toHaveBeenCalled()
    })

    it("older wakes already closed by another delivery: nothing counted on the newest", async () => {
        const { service, tx } = await door([latest("w-1", 0), latest("w-3", 2)])
        queueQueryBuilders(tx, [{ execute: { affected: 0 } }])

        await expect(service.replaceOlder(tx, set, "w-3")).resolves.toBe(0)

        expect(tx.update).not.toHaveBeenCalled()
    })
})
