import assert from "node:assert/strict"
import {
    ForbiddenException,
    ValidationPipe,
    type CanActivate,
    type ExecutionContext,
    type INestApplication,
} from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { FakeClock, mockEntityManager } from "@starci/jest-preset"
import type { FindOperator } from "typeorm"
import { JobProgressController } from "@features/realtime/job-progress/transport/sse/job-progress.controller"
import { JobProgressAccessService } from "@modules/domain/job-ops"
import { WorkspaceMembersService } from "@modules/domain/workspace-members"
import { CLOCK } from "@modules/platform/clock"
import {
    JobProgressService,
    JobProgressStreamService,
    jobProgressTopic,
    JOB_PROGRESS_STREAM,
    JOBS_MANAGERS,
    type ClaimedJob,
    type JobProgressFrame,
} from "@modules/platform/jobs"
import { LOGGER } from "@modules/platform/logging"
import { MemoryRealtimeHubService, REALTIME_HUB, type RealtimeHub } from "@modules/platform/realtime"
import {
    openJobProgressStream,
    type JobProgressReceived,
    type JobProgressStreamClient,
    type JobProgressStreamOptions,
} from "../../world/job-progress-stream-proof.service"
import { waitForProof } from "../../world/redis-proof.service"

/**
 * The generic job-progress door driven by a real event-stream client over HTTP: the real door, the real stream service, the real
 * publisher and the in-process hub; the job table is the only double (the rows the stream reads its current state from). The
 * Redis and Postgres hubs share the contract and are proven by the realtime hub specs.
 */
const WS = "11111111-1111-4111-8111-111111111111"
const OTHER_WS = "22222222-2222-4222-8222-222222222222"
const ROOT = "knowledge-source:s1"
const OTHER_ROOT = "knowledge-source:s2"
const THIRD_ROOT = "knowledge-source:s3"

/** A row of the job table as the stream reads it. */
interface TableRow {
    readonly id: string
    readonly kind: string
    readonly progressTopic: string | null
    readonly progressRetryAt: Date | null
    readonly status: "running" | "done" | "failed" | "failed_awaiting_fix"
    readonly progressDone: number | null
    readonly progressTotal: number | null
    readonly progressLabel: string | null
    readonly progressAt: Date | null
    readonly failureClass: string | null
    readonly updatedAt: Date
}

const row = (changes: Pick<TableRow, "id" | "kind"> & Partial<TableRow>): TableRow => ({
    progressTopic: `job-progress:${WS}:${ROOT}`,
    progressRetryAt: null,
    status: "running",
    progressDone: null,
    progressTotal: null,
    progressLabel: null,
    progressAt: null,
    failureClass: null,
    updatedAt: new Date("2026-11-14T10:00:00.000Z"),
    ...changes,
})

/** The one read of the stream: the operator it puts on the recorded chain name. */
interface RowsRead {
    readonly where: { readonly progressTopic: FindOperator<unknown> }
}

/** The job table as the stream asks it: the rows whose recorded chain name the `where` of the read accepts (`In` a list, `Like` a prefix). */
const rowsAsked = (table: ReadonlyArray<TableRow>, options: RowsRead): Array<TableRow> => {
    const asked = options.where.progressTopic
    return table.filter((one) => {
        if (one.progressTopic === null) return false
        if (asked.type === "in") return Array.isArray(asked.value) && asked.value.includes(one.progressTopic)
        return typeof asked.value === "string" && one.progressTopic.startsWith(asked.value.replace(/%$/u, ""))
    })
}

const isFrame = (value: unknown): value is JobProgressFrame =>
    typeof value === "object" && value !== null && "state" in value && "jobId" in value && "job" in value

const frameOf = (entry: JobProgressReceived): JobProgressFrame => {
    assert(isFrame(entry.data), "the stream must deliver job progress frames")
    return entry.data
}

const firstFrameOf = (client: JobProgressStreamClient): JobProgressFrame => {
    const [first] = client.received
    assert(first !== undefined, "the stream must deliver a frame")
    return frameOf(first)
}

const pairsOf = (entries: ReadonlyArray<JobProgressReceived>): Array<[string, string]> =>
    entries.map((entry) => [frameOf(entry).job, frameOf(entry).state])

const jobOf = (jobId: string, kind: string): ClaimedJob => ({
    jobId,
    kind,
    fencingToken: 1,
    currentStep: null,
    payload: {},
})

/** The default-deny guard of the proof: a request names its principal in a header, or it is refused. */
const principalGuard: CanActivate = {
    canActivate: (context: ExecutionContext): boolean => {
        const request = context.switchToHttp().getRequest<{ headers: Record<string, string>; principal?: object }>()
        const id = request.headers["x-principal"]
        if (id === undefined) return false
        request.principal = { id, role: "authenticated" }
        return true
    },
}

describe("job-progress SSE door with a real event-stream client", () => {
    const table: Array<TableRow> = []
    const clients: Array<JobProgressStreamClient> = []
    const clock = new FakeClock("2026-11-14T10:00:00.000Z")
    let app: INestApplication
    let origin: string
    let hub: RealtimeHub
    let publisher: JobProgressService

    const connect = async (options: JobProgressStreamOptions): Promise<JobProgressStreamClient> => {
        const client = await openJobProgressStream(origin, options)
        clients.push(client)
        return client
    }

    /** Lets the frames already published reach every open reader. */
    const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

    /** How many connections the hub holds on the workspace's ONE topic. */
    const subscribed = (expected: number, workspace = WS): Promise<number> =>
        waitForProof(
            () => Promise.resolve(hub.subscriberCount(jobProgressTopic(workspace))),
            (count) => count === expected,
        )

    const received = (client: JobProgressStreamClient, count: number): Promise<number> =>
        waitForProof(
            () => Promise.resolve(client.received.length),
            (length) => length >= count,
        )

    /** Tells a change on the topic of a chain as the state events do after the runner committed it. */
    const tell = async (
        root: string,
        job: ClaimedJob,
        state: JobProgressFrame["state"],
        change: Partial<Pick<JobProgressFrame, "attempt" | "done" | "total" | "labelKey">> = {},
        workspace = WS,
    ): Promise<void> => {
        clock.advance(1000)
        await publisher.publishTo({
            topicName: `job-progress:${workspace}:${root}`,
            job,
            jobName: job.kind,
            state,
            change,
            at: clock.now(),
        })
    }

    beforeAll(async () => {
        const manager = mockEntityManager()
        manager.find.mockImplementation(((_entity: unknown, options: RowsRead) =>
            Promise.resolve(rowsAsked(table, options))) as never)
        const members = { require: (_user: string, workspaceId: string) => workspaceId === WS ? Promise.resolve({}) : Promise.reject(new ForbiddenException()) }
        const moduleRef = await Test.createTestingModule({
            controllers: [JobProgressController],
            providers: [
                MemoryRealtimeHubService,
                { provide: REALTIME_HUB, useExisting: MemoryRealtimeHubService },
                { provide: JOBS_MANAGERS, useValue: [manager] },
                { provide: CLOCK, useValue: clock },
                { provide: LOGGER, useValue: { warn: () => undefined, error: () => undefined } },
                JobProgressService,
                JobProgressStreamService,
                { provide: JOB_PROGRESS_STREAM, useExisting: JobProgressStreamService },
                { provide: WorkspaceMembersService, useValue: members },
                JobProgressAccessService,
                { provide: APP_GUARD, useValue: principalGuard },
            ],
        }).compile()
        app = moduleRef.createNestApplication({ logger: false })
        app.useGlobalPipes(new ValidationPipe({ transform: true }))
        await app.listen(0, "127.0.0.1")
        origin = await app.getUrl()
        hub = moduleRef.get<RealtimeHub>(REALTIME_HUB)
        publisher = moduleRef.get(JobProgressService)
    })

    afterEach(async () => {
        await Promise.all(clients.splice(0).map((client) => client.disconnect()))
        table.length = 0
    })

    afterAll(async () => {
        await app.close()
    })

    it("realtime/subscriber-receives-push: a late subscriber gets the current state from the rows first, then the live frames", async () => {
        table.push(
            row({ id: "j-index", kind: "knowledge.index", status: "done" }),
            row({
                id: "j-facts",
                kind: "knowledge.facts",
                progressDone: 2,
                progressTotal: 5,
                progressLabel: "extract",
                progressAt: new Date("2026-11-14T10:00:05.000Z"),
            }),
        )
        const client = await connect({ principalId: "person-1", workspaceId: WS, root: ROOT })
        expect(client.status).toBe(200)
        await received(client, 2)

        const snapshot = client.received.slice(0, 2)
        expect(snapshot.every((entry) => entry.id === undefined)).toBe(true)
        expect(pairsOf(snapshot)).toEqual(
            expect.arrayContaining([
                ["knowledge.index", "done"],
                ["knowledge.facts", "running"],
            ]),
        )
        const facts = snapshot.map(frameOf).find((frame) => frame.job === "knowledge.facts")
        expect(facts).toMatchObject({ done: 2, total: 5, labelKey: "extract" })

        await tell(ROOT, jobOf("j-facts", "knowledge.facts"), "running", { done: 3, total: 5, labelKey: "extract" })
        await tell(ROOT, jobOf("j-facts", "knowledge.facts"), "done")
        await received(client, 4)

        const live = client.received.slice(2)
        expect(live.map((entry) => frameOf(entry).state)).toEqual(["running", "done"])
        expect(live.every((entry) => entry.id !== undefined && entry.id === frameOf(entry).id)).toBe(true)
        expect(new Set(live.map((entry) => entry.id)).size).toBe(2)
    })

    it("realtime/chain-on-one-topic: the jobs of one chain share the stream, in the order they happened", async () => {
        const client = await connect({ principalId: "person-1", workspaceId: WS, root: ROOT })
        await subscribed(1)

        await tell(ROOT, jobOf("j-1", "knowledge.index"), "running", { attempt: 1 })
        await tell(ROOT, jobOf("j-1", "knowledge.index"), "done")
        await tell(ROOT, jobOf("j-2", "knowledge.facts"), "running", { attempt: 1 })
        await received(client, 3)

        expect(pairsOf(client.received)).toEqual([
            ["knowledge.index", "running"],
            ["knowledge.index", "done"],
            ["knowledge.facts", "running"],
        ])
    })

    it("realtime/foreign-topic-is-isolated: another chain, another workspace and a non-member receive nothing of this topic", async () => {
        const mine = await connect({ principalId: "person-1", workspaceId: WS, root: ROOT })
        const foreignRoot = await connect({ principalId: "person-1", workspaceId: WS, root: OTHER_ROOT })
        const stranger = await connect({ principalId: "person-9", workspaceId: OTHER_WS, root: ROOT })
        expect(stranger.status).toBe(403)
        await subscribed(2)

        await tell(ROOT, jobOf("j-1", "knowledge.index"), "running", { attempt: 1 })
        await tell(ROOT, jobOf("j-1", "knowledge.index"), "running", { attempt: 1 }, OTHER_WS)
        await received(mine, 1)
        await settled()

        expect(mine.received).toHaveLength(1)
        expect(firstFrameOf(mine).root).toBe(ROOT)
        expect(foreignRoot.received).toHaveLength(0)
        expect(stranger.received).toHaveLength(0)
    })

    it("realtime/many-roots-on-one-connection: one stream carries the chains it names, in one snapshot and live, and no other chain", async () => {
        table.push(
            row({ id: "j-a", kind: "knowledge.index", status: "done" }),
            row({ id: "j-b", kind: "knowledge.index", progressTopic: `job-progress:${WS}:${OTHER_ROOT}` }),
            row({ id: "j-c", kind: "knowledge.index", progressTopic: `job-progress:${WS}:${THIRD_ROOT}` }),
        )
        const client = await connect({ principalId: "person-1", workspaceId: WS, roots: [ROOT, OTHER_ROOT] })
        expect(client.status).toBe(200)
        await received(client, 2)
        await subscribed(1)

        await tell(ROOT, jobOf("j-a", "knowledge.facts"), "running", { attempt: 1 })
        await tell(THIRD_ROOT, jobOf("j-c", "knowledge.facts"), "running", { attempt: 1 })
        await tell(OTHER_ROOT, jobOf("j-b", "knowledge.index"), "done")
        await received(client, 4)
        await settled()

        expect(client.received.slice(0, 2).map((entry) => frameOf(entry).root)).toEqual(expect.arrayContaining([ROOT, OTHER_ROOT]))
        expect(client.received.slice(2).map((entry) => frameOf(entry).root)).toEqual([ROOT, OTHER_ROOT])
        expect(client.received).toHaveLength(4)
    })

    it("realtime/whole-workspace: with no root the stream carries every chain of the workspace and none of another", async () => {
        table.push(
            row({ id: "j-a", kind: "knowledge.index", status: "done" }),
            row({ id: "j-x", kind: "knowledge.index", progressTopic: `job-progress:${OTHER_WS}:${ROOT}` }),
        )
        const client = await connect({ principalId: "person-1", workspaceId: WS })
        await received(client, 1)
        await subscribed(1)

        await tell(THIRD_ROOT, jobOf("j-c", "knowledge.index"), "running", { attempt: 1 })
        await tell(ROOT, jobOf("j-a", "knowledge.facts"), "running", { attempt: 1 }, OTHER_WS)
        await received(client, 2)
        await settled()

        expect(client.status).toBe(200)
        expect(client.received.map((entry) => frameOf(entry).root)).toEqual([ROOT, THIRD_ROOT])
    })

    it("realtime/retry-time-in-snapshot: a late subscriber of a job waiting for its retry is told when it runs again", async () => {
        table.push(row({ id: "j-r", kind: "knowledge.index", status: "failed", progressRetryAt: new Date("2026-11-14T10:00:30.000Z") }))
        const client = await connect({ principalId: "person-1", workspaceId: WS, roots: [ROOT] })

        await received(client, 1)

        expect(firstFrameOf(client)).toMatchObject({
            state: "retry",
            root: ROOT,
            retryAt: "2026-11-14T10:00:30.000Z",
        })
    })

    it("realtime/malformed-selector-is-refused: a malformed or oversized list opens no stream", async () => {
        const tooMany = Array.from({ length: 51 }, (_, index) => `knowledge-source:${index}`).join(",")

        expect((await connect({ principalId: "person-1", workspaceId: WS, rawRoots: `${ROOT},bad` })).status).toBe(400)
        expect((await connect({ principalId: "person-1", workspaceId: WS, rawRoots: tooMany })).status).toBe(400)
    })

    it("realtime/malformed-root-is-refused: a root with no kind prefix opens no stream", async () => {
        const client = await connect({ principalId: "person-1", workspaceId: WS, root: "no-kind" })

        expect(client.status).toBe(400)
    })

    it("realtime/unauthenticated-is-refused: a request with no principal opens no stream", async () => {
        const client = await connect({ workspaceId: WS, root: ROOT })

        expect(client.status).toBe(403)
    })

    it("realtime/disconnect-releases-subscription: the hub holds no subscription once the client left", async () => {
        const client = await connect({ principalId: "person-1", workspaceId: WS, root: ROOT })
        await subscribed(1)

        await client.disconnect()

        await subscribed(0)
    })

    it("realtime/resume-after-reconnect: a client that left mid-chain and came back with Last-Event-ID misses no fact", async () => {
        const first = await connect({ principalId: "person-1", workspaceId: WS, root: ROOT })
        await subscribed(1)
        await tell(ROOT, jobOf("j-1", "knowledge.index"), "running", { attempt: 1 })
        await received(first, 1)
        const lastId = first.received.at(-1)?.id
        assert(lastId !== undefined, "a live frame carries its id")
        await first.disconnect()

        await tell(ROOT, jobOf("j-1", "knowledge.index"), "done")
        await tell(ROOT, jobOf("j-2", "knowledge.facts"), "running", { attempt: 1 })
        table.push(
            row({ id: "j-1", kind: "knowledge.index", status: "done" }),
            row({ id: "j-2", kind: "knowledge.facts" }),
        )

        const second = await connect({ principalId: "person-1", workspaceId: WS, root: ROOT, after: lastId })
        await received(second, 4)

        const [snapshot, replayed] = [second.received.slice(0, 2), second.received.slice(2)]
        expect(snapshot.every((entry) => entry.id === lastId)).toBe(true)
        expect(pairsOf(snapshot)).toEqual(
            expect.arrayContaining([
                ["knowledge.index", "done"],
                ["knowledge.facts", "running"],
            ]),
        )
        expect(pairsOf(replayed)).toEqual([
            ["knowledge.index", "done"],
            ["knowledge.facts", "running"],
        ])
        expect(replayed.every((entry) => entry.id === frameOf(entry).id)).toBe(true)
    })
})
