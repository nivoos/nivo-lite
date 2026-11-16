import { Test } from "@nestjs/testing"
import { FakeClock, mock } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { LOGGER, type Logger } from "@modules/platform/logging"
import type { FencedProcessor } from "./fenced.processor"
import type { ClaimedJob } from "./jobs.contracts"
import { JobsLogEvent } from "./jobs.log-events"
import { defineJob } from "./job-definition"
import { JobProgressService } from "./job-progress.service"
import { JobStateEventsService } from "./job-state-events.service"

interface Payload {
    readonly workspaceId: string
    readonly sourceId: string
}

const NOW = new Date("2026-11-14T10:00:00.000Z")
const payload: Payload = { workspaceId: "WS-1", sourceId: "s1" }
const job: ClaimedJob = { jobId: "j-1", kind: "knowledge.index", fencingToken: 2, currentStep: null, payload }
const TOPIC = "job-progress:ws-1:knowledge-source:s1"

const isPayload = (value: unknown): value is Payload => typeof value === "object" && value !== null

const declared = defineJob<Payload>({
    name: "knowledge.index",
    queue: "knowledge",
    ladder: "background",
    payload: isPayload,
    onceKey: (value) => `knowledge.index:${value.sourceId}`,
    next: [],
    effects: [],
    progress: { topic: (value) => ({ workspaceId: value.workspaceId, root: `knowledge-source:${value.sourceId}` }) },
})
const silent = defineJob<Payload>({ ...declared, progress: undefined })

const processorOf = (definition: typeof declared): FencedProcessor => {
    const processor = mock<FencedProcessor>()
    Object.defineProperty(processor, "definition", { value: definition })
    return processor
}

const build = async () => {
    const progress = mock<JobProgressService>()
    progress.record.mockResolvedValue(undefined)
    progress.recordRetry.mockResolvedValue(undefined)
    progress.publishTo.mockResolvedValue(undefined)
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobStateEventsService,
            { provide: JobProgressService, useValue: progress },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { events: moduleRef.get(JobStateEventsService), progress, logger }
}

describe("JobStateEventsService changed", () => {
    it("publishes nothing for a job that declares no progress", async () => {
        const { events, progress } = await build()

        await events.changed(processorOf(silent), job, { kind: "running", attempt: 1 })

        expect(progress.record).not.toHaveBeenCalled()
        expect(progress.publishTo).not.toHaveBeenCalled()
    })

    it("records the topic on the row at running and publishes the running frame with its attempt", async () => {
        const { events, progress } = await build()

        await events.changed(processorOf(declared), job, { kind: "running", attempt: 2 })

        expect(progress.record).toHaveBeenCalledWith(job, TOPIC)
        expect(progress.publishTo).toHaveBeenCalledWith({ topicName: TOPIC, job, jobName: "knowledge.index", state: "running", change: { attempt: 2 }, at: NOW })
    })

    it("tells a retry with the time it runs again, a dead letter with its class, and done", async () => {
        const { events, progress } = await build()
        const processor = processorOf(declared)

        await events.changed(processor, job, { kind: "retry", attempt: 1, afterSeconds: 30 })
        await events.changed(processor, job, { kind: "dead-letter", failureClass: "input" })
        await events.changed(processor, job, { kind: "done" })

        expect(progress.record).not.toHaveBeenCalled()
        expect(progress.recordRetry).toHaveBeenCalledTimes(1)
        expect(progress.recordRetry).toHaveBeenCalledWith(job, new Date("2026-11-14T10:00:30.000Z"))
        expect(progress.publishTo.mock.calls.map(([call]) => [call.state, call.change])).toEqual([
            ["retry", { attempt: 1, retryAt: "2026-11-14T10:00:30.000Z" }],
            ["dead_letter", { failureClass: "input" }],
            ["done", {}],
        ])
    })

    it("never throws: a failing record is logged and the frame is not published", async () => {
        const { events, progress, logger } = await build()
        progress.record.mockRejectedValue(new Error("db down"))

        await expect(events.changed(processorOf(declared), job, { kind: "running", attempt: 1 })).resolves.toBeUndefined()

        expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.ProgressNotTold, expect.any(Error), expect.objectContaining({ jobId: "j-1" }))
        expect(progress.publishTo).not.toHaveBeenCalled()
    })
})
