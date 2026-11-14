import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { buildChainRunner, deliveryOf, networkRefused } from "@tests/fixtures/builders/job-chain-runner.builder"
import { AgentTriggersService } from "@modules/domain/agent-work"
import type { AgentTriggerRecord } from "@modules/domain/agent-work"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_SCHEDULES, SCHEDULE_ATTEMPTS } from "@modules/platform/queue"
import type { QueueSchedules } from "@modules/platform/queue"
import { AGENT_SCHEDULE_FIRE_QUEUE, FIRE_AGENT_SCHEDULE_JOB, type AgentScheduleFirePayload } from "@modules/queues/agent-turn"
import { AgentScheduleFireService } from "./agent-schedule-fire.service"
import { AgentTriggerSyncService } from "./agent-trigger-sync.service"
import { ClockTickDeliveryService } from "./clock-tick-delivery.service"

/** The runner reads the workspace of a payload only when it is a uuid. */
const WS = "11111111-1111-4111-8111-111111111111"
const PAYLOAD: AgentScheduleFirePayload = { workspaceId: WS, agentId: "agent-1", triggerId: "trigger-1", slot: "1794283200000" }
const TRIGGER: AgentTriggerRecord = {
    id: "trigger-1",
    agentId: "agent-1",
    kind: "schedule",
    preset: "hourly",
    atTime: null,
    timeZone: "Asia/Ho_Chi_Minh",
    eventName: null,
    enabled: true,
    seedKey: null,
    nextRunAt: null,
    lastFiredAt: null,
}

/** The processor of the fire queue as the feature composes it: scheduled, one domain method, nothing in `onFailed`. */
class FireProcessor extends FencedProcessor {
    override readonly queue = AGENT_SCHEDULE_FIRE_QUEUE
    override readonly definition: JobDefinition<AgentScheduleFirePayload> = FIRE_AGENT_SCHEDULE_JOB
    override readonly scheduled = true
    constructor(private readonly fires: AgentScheduleFireService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.fires.fire(job)
    }
}

const build = async () => {
    const tx = fakeTransaction(mockEntityManager())
    const triggers = mock<AgentTriggersService>({ byId: jest.fn().mockResolvedValue(TRIGGER), recordFire: jest.fn().mockResolvedValue(undefined) })
    const wakes = mock<ClockTickDeliveryService>({ deliverSlot: jest.fn().mockResolvedValue("woken") })
    const sync = mock<AgentTriggerSyncService>({ workIsOn: jest.fn().mockResolvedValue(true) })
    const moduleRef = await Test.createTestingModule({
        providers: [
            AgentScheduleFireService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: QUEUE_SCHEDULES, useValue: mock<QueueSchedules>({ nextOf: jest.fn().mockResolvedValue(new Date("2026-11-10T04:06:00.000Z")) }) },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: AgentTriggersService, useValue: triggers },
            { provide: ClockTickDeliveryService, useValue: wakes },
            { provide: AgentTriggerSyncService, useValue: sync },
        ],
    }).compile()
    return { processor: new FireProcessor(moduleRef.get(AgentScheduleFireService)), wakes, triggers }
}

const deliver = (runner: Awaited<ReturnType<typeof buildChainRunner>>, processor: FireProcessor, attempt: number) =>
    runner.runner.run(processor, deliveryOf(AGENT_SCHEDULE_FIRE_QUEUE, FIRE_AGENT_SCHEDULE_JOB.name, PAYLOAD, attempt))

describe("agent schedule fire chain: a scheduled fire that fails ends as the broker's tries, then ONE dead letter, and a resume fires the slot", () => {
    it("a database that stays down: the broker retries (the original error is rethrown) and the last try parks once; the resume delivers the slot", async () => {
        const t = await build()
        const run = await buildChainRunner()
        run.claimed(PAYLOAD)
        const down = networkRefused()
        t.wakes.deliverSlot.mockRejectedValue(down)

        // Tries 1 and 2: the failure is recorded and rethrown so the broker backs off and tries again; nothing parks.
        for (let attempt = 1; attempt < SCHEDULE_ATTEMPTS; attempt += 1) {
            await expect(deliver(run, t.processor, attempt)).rejects.toBe(down)
        }
        expect(run.claims.park).not.toHaveBeenCalled()
        expect(run.deadLetters.raise).not.toHaveBeenCalled()

        // The last try: the scheduled fire is dead-lettered like any job: parked, ONE item, the delivery acknowledged.
        await expect(deliver(run, t.processor, SCHEDULE_ATTEMPTS)).resolves.toBeUndefined()

        expect(run.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(run.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", workspaceId: WS, episode: 0 }))
        expect(t.triggers.recordFire).not.toHaveBeenCalled()

        // The cause is fixed; a person resumes: the same slot is delivered and recorded; no second item.
        t.wakes.deliverSlot.mockResolvedValue("woken")
        run.claimed(PAYLOAD, 1)
        await deliver(run, t.processor, 1)

        expect(t.wakes.deliverSlot).toHaveBeenLastCalledWith(expect.anything(), WS, TRIGGER, PAYLOAD.slot, null)
        expect(t.triggers.recordFire).toHaveBeenCalledTimes(1)
        expect(run.claims.complete).toHaveBeenCalledTimes(1)
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
    })

    it("a failure no retry can fix parks at once, without spending the broker's tries", async () => {
        const t = await build()
        const run = await buildChainRunner()
        run.claimed({ ...PAYLOAD, slot: undefined })

        await expect(deliver(run, t.processor, 1)).resolves.toBeUndefined()

        expect(run.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "payload refused: agent-schedule.fire" }))
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.wakes.deliverSlot).not.toHaveBeenCalled()
    })
})
