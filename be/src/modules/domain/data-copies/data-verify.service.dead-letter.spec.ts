import { Test } from "@nestjs/testing"
import type { MemoryDriver } from "@modules/integrations/seed"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DATA_COPIES_QUEUE, VERIFY_DATA_JOB, type DataCopiesTickPayload } from "@modules/queues/data-copies"
import { copyWorld, memoryDriver, writeCopy } from "@tests/fixtures/builders/data-copies.builder"
import { buildChainRunner, deliveryOf } from "@tests/fixtures/builders/job-chain-runner.builder"
import { DataVerifyService } from "./data-verify.service"

const PAYLOAD: DataCopiesTickPayload = { tick: true }
const PAUSES = [5, 10, 20]

/** A matcher for a text that contains a part: typed `unknown` so it flows into any slot of an expected object. */
const text = (part: string): unknown => expect.stringContaining(part)

/** The processor of the job as the feature composes it: one domain method. */
class VerifyProcessor extends FencedProcessor {
    override readonly queue = DATA_COPIES_QUEUE
    override readonly definition: JobDefinition<DataCopiesTickPayload> = VERIFY_DATA_JOB
    constructor(private readonly verify: DataVerifyService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.verify.run(job)
    }
}

const build = async (git: MemoryDriver, s3: MemoryDriver) => {
    const world = copyWorld([git, s3])
    await writeCopy(git, world.stores)
    await writeCopy(s3, world.stores)
    const moduleRef = await Test.createTestingModule({ providers: [DataVerifyService, ...world.providers] }).compile()
    return new VerifyProcessor(moduleRef.get(DataVerifyService))
}

const deliver = (run: Awaited<ReturnType<typeof buildChainRunner>>, processor: VerifyProcessor, attempt: number) =>
    run.runner.run(processor, deliveryOf(DATA_COPIES_QUEUE, VERIFY_DATA_JOB.name, PAYLOAD, attempt))

describe("data verify chain: a finding is ONE dead letter, an unreachable driver is a bounded retry", () => {
    it("a corrupted copy parks at once (input, no retry spent) with ONE item naming the driver and the failed check", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const processor = await build(git, memoryDriver({ id: "s3-copy", kind: "s3" }))
        git.corrupt("contacts", "ana@example.test")
        const run = await buildChainRunner()
        run.claimed(PAYLOAD)

        await deliver(run, processor, 1)

        expect(run.claims.fail).not.toHaveBeenCalled()
        expect(run.claims.park).toHaveBeenCalledWith(
            expect.objectContaining({ failureClass: "input", reason: text("nivo-lite: git-copy: failed") }),
        )
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
    })

    it("a driver that cannot be reached is retried on the background ladder, then parked once with the transient class", async () => {
        const git = memoryDriver({
            id: "git-copy",
            fail: { on: "verify", code: "DATA_DRIVER_UNAVAILABLE", retry: "transient" },
        })
        const processor = await build(git, memoryDriver({ id: "s3-copy", kind: "s3" }))
        const run = await buildChainRunner()
        run.claimed(PAYLOAD)

        for (const attempt of [1, 2, 3]) {
            await expect(deliver(run, processor, attempt)).rejects.toMatchObject({
                params: { seconds: PAUSES[attempt - 1] },
            })
        }
        await deliver(run, processor, 4)

        expect(run.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
    })
})
