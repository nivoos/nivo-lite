import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { WorkspaceMemberSeatsService, type MemberSeatRecord } from "@modules/domain/workspace-members"
import { EVENT_BUS, EVENT_CONSUMER_REGISTRY } from "@modules/platform/event-bus"
import type { EventBus, EventConsumerRegistry } from "@modules/platform/event-bus"
import { JobOpsErrorCode } from "./errors/job-ops.error"
import { STOPPED_EVENTS_LIMIT } from "./stopped-events.contracts"
import { StoppedEventsService } from "./stopped-events.service"

/** A dead letter as the bus lists it. */
type DeadLetter = Awaited<ReturnType<EventBus["deadLetters"]>>[number]

const WS = "11111111-1111-4111-8111-111111111111"
const OTHER_WS = "99999999-9999-4999-8999-999999999999"
const OWNER = "22222222-2222-4222-8222-222222222222"
const MANAGER = "55555555-5555-4555-8555-555555555555"
const QUEUE = "knowledge_source_indexed__agent_wakes"

/** A buried event of a workspace: the envelope as the publisher sent it, wrapped as the dead-letter queue keeps it. */
const letterOf = (id: string, eventId: string, workspaceId: string | null, reason = "input"): DeadLetter => ({
    id,
    reason,
    readCount: 1,
    message: { eventId, eventName: "knowledge.source-indexed", payload: { dedupeKey: eventId, ...(workspaceId === null ? {} : { workspaceId }) } },
})

/** The door over doubles: two consumer queues; the first holds a buried event of this workspace, one of another, one that names none. */
const build = async () => {
    const bus = mock<EventBus>()
    bus.deadLetters.mockImplementation((queue) =>
        Promise.resolve(
            queue === QUEUE
                ? [letterOf("7", "event-mine", WS), letterOf("8", "event-theirs", OTHER_WS), letterOf("9", "event-nobody", null, "malformed")]
                : [],
        ),
    )
    bus.requeue.mockResolvedValue(true)
    const consumers = mock<EventConsumerRegistry>()
    consumers.queues.mockReturnValue([QUEUE, "installation_changed__agent_wakes"])
    const seats = mock<WorkspaceMemberSeatsService>()
    seats.activeSeatOfUser.mockImplementation((_workspaceId, userId) =>
        Promise.resolve(userId === OWNER ? mock<MemberSeatRecord>({ role: "owner" }) : userId === MANAGER ? mock<MemberSeatRecord>({ role: "manager" }) : null),
    )
    const moduleRef = await Test.createTestingModule({
        providers: [
            StoppedEventsService,
            { provide: EVENT_BUS, useValue: bus },
            { provide: EVENT_CONSUMER_REGISTRY, useValue: consumers },
            { provide: WorkspaceMemberSeatsService, useValue: seats },
        ],
    }).compile()
    return { service: moduleRef.get(StoppedEventsService), bus, consumers }
}

describe("StoppedEventsService", () => {
    describe("list", () => {
        it("answers the buried events whose payload names this workspace, queue by queue, and no other", async () => {
            const { service, bus } = await build()

            await expect(service.list(OWNER, WS)).resolves.toEqual([
                { queue: QUEUE, eventId: "event-mine", eventName: "knowledge.source-indexed", reason: "input", readCount: 1 },
            ])

            expect(bus.deadLetters).toHaveBeenCalledWith(QUEUE, STOPPED_EVENTS_LIMIT)
            expect(bus.deadLetters).toHaveBeenCalledWith("installation_changed__agent_wakes", STOPPED_EVENTS_LIMIT)
        })

        it("refuses a manager and a stranger with the owner-only code, reading nothing", async () => {
            const { service, bus } = await build()

            for (const user of [MANAGER, "00000000-0000-4000-8000-000000000000"]) {
                await expect(service.list(user, WS)).rejects.toMatchObject({ code: JobOpsErrorCode.StoppedWorkNeedsOwner })
            }
            expect(bus.deadLetters).not.toHaveBeenCalled()
        })
    })

    describe("requeue", () => {
        it("sends the event back by the id of its dead-letter row", async () => {
            const { service, bus } = await build()

            await expect(service.requeue(OWNER, WS, QUEUE, "event-mine")).resolves.toBe(true)

            expect(bus.requeue).toHaveBeenCalledWith(QUEUE, "7")
        })

        it.each([
            { why: "an event of another workspace", queue: QUEUE, eventId: "event-theirs" },
            { why: "an event that names no workspace", queue: QUEUE, eventId: "event-nobody" },
            { why: "an id nobody buried", queue: QUEUE, eventId: "event-none" },
            { why: "a queue no reactor of this app subscribed", queue: "other__queue", eventId: "event-mine" },
        ])("answers false for $why, and sends nothing back", async ({ queue, eventId }) => {
            const { service, bus } = await build()

            await expect(service.requeue(OWNER, WS, queue, eventId)).resolves.toBe(false)

            expect(bus.requeue).not.toHaveBeenCalled()
        })

        it("refuses a manager before reading anything", async () => {
            const { service, bus } = await build()

            await expect(service.requeue(MANAGER, WS, QUEUE, "event-mine")).rejects.toMatchObject({ code: JobOpsErrorCode.StoppedWorkNeedsOwner })

            expect(bus.deadLetters).not.toHaveBeenCalled()
            expect(bus.requeue).not.toHaveBeenCalled()
        })
    })
})
