import { Test } from "@nestjs/testing"
import type { MemoryDriver } from "@modules/integrations/seed"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { BACKUP_DATA_JOB, DATA_COPIES_QUEUE, type DataBackupPayload } from "@modules/queues/data-copies"
import { copyWorld, downUntilUp, memoryDriver } from "@tests/fixtures/builders/data-copies.builder"
import { buildChainRunner, deliveryOf } from "@tests/fixtures/builders/job-chain-runner.builder"
import { DataBackupService } from "./data-backup.service"

const PAYLOAD: DataBackupPayload = { setId: "nivo-lite", slot: 20_000 }
const PAUSES = [5, 10, 20]

/** A matcher for a text that contains a part: typed `unknown` so it flows into any slot of an expected object. */
const text = (part: string): unknown => expect.stringContaining(part)

/** The processor of the job as the feature composes it: one domain method. */
class BackupProcessor extends FencedProcessor {
    override readonly queue = DATA_COPIES_QUEUE
    override readonly definition: JobDefinition<DataBackupPayload> = BACKUP_DATA_JOB
    constructor(private readonly backup: DataBackupService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.backup.run(job)
    }
}

const build = async (drivers: ReadonlyArray<MemoryDriver>) => {
    const world = copyWorld(drivers)
    const moduleRef = await Test.createTestingModule({ providers: [DataBackupService, ...world.providers] }).compile()
    return { processor: new BackupProcessor(moduleRef.get(DataBackupService)), ...world }
}

const deliver = (run: Awaited<ReturnType<typeof buildChainRunner>>, processor: BackupProcessor, attempt: number) =>
    run.runner.run(processor, deliveryOf(DATA_COPIES_QUEUE, BACKUP_DATA_JOB.name, PAYLOAD, attempt))

describe("data backup chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("a driver that is down: retried on the background ladder (5, 10, 20 s), parked once on the 4th start; the resume writes the copy once", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = downUntilUp(memoryDriver({ id: "s3-copy", kind: "s3" }))
        const t = await build([git, s3.driver])
        const run = await buildChainRunner()
        run.claimed(PAYLOAD)

        for (const attempt of [1, 2, 3]) {
            await expect(deliver(run, t.processor, attempt)).rejects.toMatchObject({
                params: { seconds: PAUSES[attempt - 1] },
            })
        }
        expect(run.claims.park).not.toHaveBeenCalled()

        await deliver(run, t.processor, 4)

        expect(run.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        // The other copy was written on the first start and kept; no later start wrote it again.
        expect((await git.list()).length).toBe(1)
        expect(t.ledger.rows.get("job-1:data.copy-write:git-copy")?.acts).toBe(1)

        s3.up()
        run.claimed(PAYLOAD, 1)
        await deliver(run, t.processor, 1)

        expect(run.claims.complete).toHaveBeenCalledTimes(1)
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect([(await git.list()).length, (await s3.driver.list()).length]).toEqual([1, 1])
    })

    it("a copy that outgrew git parks at once (configuration, no retry spent) with ONE item naming the driver and the code", async () => {
        const git = memoryDriver({ id: "git-copy", limits: { maxCopyBytes: 10 } })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])
        const run = await buildChainRunner()
        run.claimed(PAYLOAD)

        await deliver(run, t.processor, 1)

        expect(run.claims.fail).not.toHaveBeenCalled()
        expect(run.claims.park).toHaveBeenCalledWith(
            expect.objectContaining({
                failureClass: "config",
                reason: text("driver git-copy refused with DATA_GIT_CAP_EXCEEDED"),
            }),
        )
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect([(await git.list()).length, (await s3.list()).length]).toEqual([0, 1])
    })
})
