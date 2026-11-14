import { Test } from "@nestjs/testing"
import { FakeClock, mock } from "@starci/jest-preset"
import { ConnectionsService, type HealthCandidate } from "@modules/domain/connections"
import { CLOCK } from "@modules/platform/clock"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { CHECK_CONNECTION_HEALTH_JOB, type ConnectionHealthPayload } from "@modules/queues/connection-health"
import { buildRunner, deliveryOf, killed, networkDown, startsOf } from "@tests/fixtures/builders/provider-connections.builder"
import { ConnectionHealthService } from "./connection-health.service"

/** The processor of the health tick as the feature composes it: one domain method. */
class HealthProcessor extends FencedProcessor {
    override readonly queue = "connection_health"
    override readonly definition: JobDefinition<ConnectionHealthPayload> = CHECK_CONNECTION_HEALTH_JOB
    constructor(private readonly health: ConnectionHealthService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.health.checkFromJob(job.payload)
    }
}

const payload = { silentAfterHours: 72 }
const delivery = (attempt: number) => deliveryOf("connection_health", "connection_health", payload, attempt)
const silent = (id: string, health = ""): HealthCandidate => ({
    id,
    workspaceId: "ws-1",
    provider: "telegram",
    name: id,
    status: "connected",
    lastError: "",
    lastEventAt: "2026-10-01T09:00:00.000Z",
    createdAt: "2026-09-01T09:00:00.000Z",
    health,
})

const build = async () => {
    const connections = mock<ConnectionsService>()
    connections.healthBatch.mockResolvedValue([])
    connections.markHealth.mockResolvedValue(undefined)
    const moduleRef = await Test.createTestingModule({
        providers: [
            ConnectionHealthService,
            { provide: CLOCK, useValue: new FakeClock("2026-10-12T10:00:00.000Z") },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: ConnectionsService, useValue: connections },
        ],
    }).compile()
    return { service: moduleRef.get(ConnectionHealthService), connections }
}

describe("connection health chain: the job is run twice, the second run repeats no finished step", () => {
    it("a kill after the first verdict was recorded: the second run records only what is still unrecorded", async () => {
        const t = await build()
        t.connections.healthBatch.mockResolvedValue([silent("c-1"), silent("c-2")])
        t.connections.markHealth.mockResolvedValueOnce(undefined).mockRejectedValueOnce(killed())

        await expect(t.service.checkFromJob(payload)).rejects.toMatchObject({ code: "ECONNRESET" })
        // The verdict of c-1 is on its row now: the next batch read finds it recorded.
        t.connections.healthBatch.mockResolvedValue([silent("c-1", "silent"), silent("c-2")])
        await expect(t.service.checkFromJob(payload)).resolves.toMatchObject({ changed: 1 })

        expect(t.connections.markHealth.mock.calls.map((call) => call[0])).toEqual(["c-1", "c-2", "c-2"])
    })
})

describe("connection health chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("the database unreachable: the background ladder 5, 10, 20 s, then one dead letter with one item; the resume completes", async () => {
        const t = await build()
        const run = await buildRunner()
        const processor = new HealthProcessor(t.service)
        t.connections.healthBatch.mockRejectedValue(networkDown())
        run.claimed(payload)

        const seen = await startsOf(run.runner, processor, delivery, 4)

        expect(seen).toEqual([5, 10, 20, "returned"])
        expect(run.claims.park).toHaveBeenCalledTimes(1)
        expect(run.claims.park.mock.calls[0]?.[0]).toMatchObject({ failureClass: "transient", queue: "connection_health" })
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)

        t.connections.healthBatch.mockResolvedValue([silent("c-1")])
        const resumed = await buildRunner(1)
        resumed.claimed(payload)
        await resumed.runner.run(processor, delivery(1))

        expect(t.connections.markHealth).toHaveBeenCalledTimes(1)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })
})
