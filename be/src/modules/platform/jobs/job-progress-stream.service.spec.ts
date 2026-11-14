import type { MessageEvent } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { FakeClock, mockEntityManager } from "@starci/jest-preset"
import { FindOperator } from "typeorm"
import { CLOCK } from "@modules/platform/clock"
import { MemoryRealtimeHubService, REALTIME_HUB } from "@modules/platform/realtime"
import { JOBS_MANAGERS } from "./jobs.decorators"
import { isJobProgressFrame, jobProgressTopic, type JobProgressFrame } from "./job-progress.policy"
import { JobProgressStreamService } from "./job-progress-stream.service"
import { JobEntity } from "./persistence/entities"

const NOW = new Date("2026-11-14T12:00:00.000Z")
const workspace = { workspaceId: "ws-1" }
const one = { workspaceId: "ws-1", root: "knowledge-source:s1" }

const rowOf = (id: string, kind: string, status: JobEntity["status"], at: string, root = "knowledge-source:s1"): JobEntity =>
    Object.assign(new JobEntity(), {
        id,
        kind,
        status,
        failureClass: null,
        progressTopic: `job-progress:ws-1:${root}`,
        progressDone: null,
        progressTotal: null,
        progressLabel: null,
        progressAt: null,
        progressRetryAt: null,
        updatedAt: new Date(at),
    })

const frameOf = (id: string, root = "knowledge-source:s1"): JobProgressFrame => ({
    id,
    kind: "job",
    root,
    job: "knowledge.facts",
    jobId: "j-9",
    state: "running",
    at: "2026-11-14T10:00:09.000Z",
})

/** The service over the rows the table holds; `release` lets the pending read of the rows finish. */
const build = async (rows: ReadonlyArray<JobEntity>) => {
    const manager = mockEntityManager()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    manager.find.mockImplementation(() => gate.then(() => [...rows]))
    const moduleRef = await Test.createTestingModule({
        providers: [
            MemoryRealtimeHubService,
            { provide: REALTIME_HUB, useExisting: MemoryRealtimeHubService },
            { provide: JOBS_MANAGERS, useValue: [manager] },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            JobProgressStreamService,
        ],
    }).compile()
    return { service: moduleRef.get(JobProgressStreamService), hub: moduleRef.get(MemoryRealtimeHubService), manager, release }
}

/** The operator the one read of the table put on a column of its `where`. */
const operatorOf = (options: unknown, column: string): FindOperator<unknown> | undefined => {
    if (typeof options !== "object" || options === null || !("where" in options)) return undefined
    const { where } = options
    if (typeof where !== "object" || where === null) return undefined
    const operator: unknown = Reflect.get(where, column)
    return operator instanceof FindOperator ? operator : undefined
}

/** Lets every pending promise step settle. */
const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const dataOf = (events: ReadonlyArray<MessageEvent>): Array<MessageEvent> => events.filter((event) => event.data !== undefined)

const rootsOf = (events: ReadonlyArray<MessageEvent>): Array<string | undefined> =>
    dataOf(events).map((event) => (isJobProgressFrame(event.data) ? event.data.root : undefined))

describe("JobProgressStreamService current", () => {
    it("keeps the latest row of each job name of a chain, oldest job first", async () => {
        const { service, release } = await build([
            rowOf("new-index", "knowledge.index", "done", "2026-11-14T10:00:05.000Z"),
            rowOf("facts", "knowledge.facts", "running", "2026-11-14T10:00:04.000Z"),
            rowOf("old-index", "knowledge.index", "failed", "2026-11-14T10:00:01.000Z"),
        ])
        release()

        const frames = await service.current(one)

        expect(frames.map((frame) => [frame.jobId, frame.state])).toEqual([
            ["facts", "running"],
            ["new-index", "done"],
        ])
    })

    it("keeps one frame per chain and job name when many chains are asked, each frame carrying its root", async () => {
        const { service, release } = await build([
            rowOf("a-index", "knowledge.index", "done", "2026-11-14T10:00:05.000Z", "knowledge-source:a"),
            rowOf("b-index", "knowledge.index", "running", "2026-11-14T10:00:04.000Z", "knowledge-source:b"),
            rowOf("a-old", "knowledge.index", "failed", "2026-11-14T10:00:01.000Z", "knowledge-source:a"),
        ])
        release()

        const frames = await service.current({ workspaceId: "ws-1", roots: "knowledge-source:a,knowledge-source:b" })

        expect(frames.map((frame) => [frame.root, frame.jobId])).toEqual([
            ["knowledge-source:b", "b-index"],
            ["knowledge-source:a", "a-index"],
        ])
    })

    it("asks the table for exactly the chain names of the asked roots of this workspace", async () => {
        const { service, manager, release } = await build([])
        release()

        await service.current({ workspaceId: "WS-1", roots: "k:1,k:2" })

        expect(operatorOf(manager.find.mock.calls[0]?.[1], "progressTopic")?.value).toEqual(["job-progress:ws-1:k:1", "job-progress:ws-1:k:2"])
    })

    it("reads the rows of every chain of the workspace changed in the last 24 hours when no root is asked", async () => {
        const { service, manager, release } = await build([])
        release()

        await service.current(workspace)

        expect(operatorOf(manager.find.mock.calls[0]?.[1], "progressTopic")?.value).toBe("job-progress:ws-1:%")
        expect(operatorOf(manager.find.mock.calls[0]?.[1], "updatedAt")?.value).toEqual(new Date("2026-11-13T12:00:00.000Z"))
    })

    it("tells a waiting retry with the time it runs again, and skips a row that records no chain", async () => {
        const waiting = rowOf("retrying", "knowledge.index", "failed", "2026-11-14T11:59:00.000Z")
        waiting.progressRetryAt = new Date("2026-11-14T12:00:30.000Z")
        const alien = rowOf("alien", "knowledge.facts", "done", "2026-11-14T11:00:00.000Z")
        alien.progressTopic = null
        const { service, release } = await build([waiting, alien])
        release()

        const frames = await service.current(workspace)

        expect(frames).toHaveLength(1)
        expect(frames[0]).toMatchObject({ state: "retry", retryAt: "2026-11-14T12:00:30.000Z" })
    })
})

describe("JobProgressStreamService open", () => {
    it("emits the current state before a live frame that was published while the rows were being read", async () => {
        const { service, hub, release } = await build([rowOf("index", "knowledge.index", "done", "2026-11-14T10:00:05.000Z")])
        const events: Array<MessageEvent> = []
        const subscription = service.open(one).subscribe((event) => events.push(event))

        await hub.publish(jobProgressTopic("ws-1"), frameOf("live-1"))
        await settled()
        expect(dataOf(events)).toHaveLength(0)
        release()
        await settled()
        subscription.unsubscribe()

        expect(dataOf(events).map((event) => event.id)).toEqual(["", "live-1"])
        expect(dataOf(events).map((event) => (isJobProgressFrame(event.data) ? event.data.jobId : undefined))).toEqual(["index", "j-9"])
    })

    it("repeats the client's Last-Event-ID on the snapshot so it never moves the resume point", async () => {
        const { service, release } = await build([rowOf("index", "knowledge.index", "done", "2026-11-14T10:00:05.000Z")])
        const events: Array<MessageEvent> = []
        const subscription = service.open(one, "live-0").subscribe((event) => events.push(event))

        release()
        await settled()
        subscription.unsubscribe()

        expect(events.find((event) => event.data !== undefined)?.id).toBe("live-0")
    })

    it("delivers only the live frames of the asked roots on the workspace topic", async () => {
        const { service, hub, release } = await build([])
        release()
        const events: Array<MessageEvent> = []
        const asked = { workspaceId: "ws-1", roots: "knowledge-source:a,knowledge-source:b" }
        const subscription = service.open(asked).subscribe((event) => events.push(event))
        await settled()

        await hub.publish(jobProgressTopic("ws-1"), frameOf("f-a", "knowledge-source:a"))
        await hub.publish(jobProgressTopic("ws-1"), frameOf("f-c", "knowledge-source:c"))
        await hub.publish(jobProgressTopic("ws-1"), frameOf("f-b", "knowledge-source:b"))
        await settled()
        subscription.unsubscribe()

        expect(rootsOf(events)).toEqual(["knowledge-source:a", "knowledge-source:b"])
    })

    it("delivers the live frames of every chain when no root is asked, and none of another workspace", async () => {
        const { service, hub, release } = await build([])
        release()
        const events: Array<MessageEvent> = []
        const subscription = service.open(workspace).subscribe((event) => events.push(event))
        await settled()

        await hub.publish(jobProgressTopic("ws-1"), frameOf("f-a", "knowledge-source:a"))
        await hub.publish(jobProgressTopic("ws-2"), frameOf("f-x", "knowledge-source:x"))
        await hub.publish(jobProgressTopic("ws-1"), frameOf("f-c", "knowledge-source:c"))
        await settled()
        subscription.unsubscribe()

        expect(rootsOf(events)).toEqual(["knowledge-source:a", "knowledge-source:c"])
    })

    it("releases the hub subscription when the client leaves", async () => {
        const { service, hub } = await build([])
        const subscription = service.open(one).subscribe()
        expect(hub.subscriberCount(jobProgressTopic("ws-1"))).toBe(1)

        subscription.unsubscribe()

        expect(hub.subscriberCount(jobProgressTopic("ws-1"))).toBe(0)
    })
})
