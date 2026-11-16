import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { AgentTriggersService } from "@modules/domain/agent-work"
import type { AgentTriggerRecord } from "@modules/domain/agent-work"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import type { ClaimedJob } from "@modules/platform/jobs"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_SCHEDULES } from "@modules/platform/queue"
import type { QueueSchedules } from "@modules/platform/queue"
import { AgentScheduleFireService } from "./agent-schedule-fire.service"
import { AgentTriggerSyncService } from "./agent-trigger-sync.service"
import { ClockTickDeliveryService } from "./clock-tick-delivery.service"

const SLOT = "1794283200000"
const JOB: ClaimedJob = {
    jobId: "job-1",
    kind: "agent-schedule.fire",
    fencingToken: 1,
    currentStep: "fire",
    payload: { workspaceId: "ws-1", agentId: "agent-1", triggerId: "trigger-1", slot: SLOT },
}
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

/** The process "dies" here: the error a write throws when its worker is gone. */
const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

describe("agent schedule fire chain: the job is run twice, the second run repeats no finished step", () => {
    it("a kill inside the fire transaction writes nothing; the second run delivers the same slot and records it once", async () => {
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
        const service = moduleRef.get(AgentScheduleFireService)
        // The worker dies after the wake was written, before the fire is recorded: the one transaction rolls back, nothing stays.
        triggers.recordFire.mockRejectedValueOnce(killed())

        await expect(service.fire(JOB)).rejects.toMatchObject({ code: "ECONNRESET" })

        expect(tx.commits).toBe(0)

        await expect(service.fire(JOB)).resolves.toBe(true)

        // Both runs delivered the SAME slot (the wake's once key `<triggerId>:<slot>` makes the second one a no-op in the real door),
        // and the fire was recorded and committed once.
        expect(wakes.deliverSlot.mock.calls.map((call) => call[3])).toEqual([SLOT, SLOT])
        expect(wakes.deliverSlot.mock.calls.map((call) => call[2])).toEqual([TRIGGER, TRIGGER])
        expect(triggers.recordFire).toHaveBeenCalledTimes(2)
        expect(tx.commits).toBe(1)
    })
})
