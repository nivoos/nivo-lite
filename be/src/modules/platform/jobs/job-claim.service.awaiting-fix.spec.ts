import { Test } from "@nestjs/testing"
import { FakeClock, mockEntityManager, queueQueryBuilders } from "@starci/jest-preset"
import { PARKED_AT, parkedJobRows, type ParkedJobRowFacts } from "@tests/fixtures/builders/parked-job-rows.builder"
import { CLOCK } from "@modules/platform/clock"
import { JOBS_MANAGERS } from "./jobs.decorators"
import { JobClaimService } from "./job-claim.service"

const AT = "2026-02-03T04:05:06.000Z"
const WS = "11111111-1111-4111-8111-111111111111"

const build = async (rows: ReadonlyArray<ParkedJobRowFacts>) => {
    const manager = mockEntityManager({})
    const [builder] = queueQueryBuilders(manager, [{ getMany: rows }])
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobClaimService,
            { provide: JOBS_MANAGERS, useValue: [manager] },
            { provide: CLOCK, useValue: new FakeClock(AT) },
        ],
    }).compile()
    return { claims: moduleRef.get(JobClaimService), builder }
}

describe("JobClaimService > awaitingFix", () => {
    it("reads the parked rows of the workspace, oldest park first, bounded by the limit", async () => {
        const { claims, builder } = await build([parkedJobRows.unreadableSource()])

        await claims.awaitingFix(WS, 50)

        expect(builder?.callsOf("where")).toEqual([
            [
                "job.status = :parked AND job.payload ->> 'workspaceId' = :workspaceId",
                { parked: "failed_awaiting_fix", workspaceId: WS },
            ],
        ])
        expect(builder?.callsOf("orderBy")).toEqual([["job.parkedAt", "ASC"]])
        expect(builder?.callsOf("limit")).toEqual([[50]])
    })

    it("answers each row as the job, its class, the failure code, when it parked and how often it was resumed", async () => {
        const { claims } = await build([parkedJobRows.unreadableSource(), parkedJobRows.vectorStoreDown()])

        await expect(claims.awaitingFix(WS, 50)).resolves.toEqual([
            {
                jobId: "j-1",
                job: "extract-knowledge-facts",
                failureClass: "input",
                reason: "KNOWLEDGE_SOURCE_UNREADABLE",
                parkedAt: PARKED_AT,
                resumeCount: 1,
            },
            { jobId: "j-2", job: "sync-vectors", failureClass: "transient", reason: "QDRANT_DOWN", parkedAt: PARKED_AT, resumeCount: 0 },
        ])
    })

    it("a row with no recorded class reads as code, a row with no error as an empty reason", async () => {
        const { claims } = await build([parkedJobRows.unclassified()])

        await expect(claims.awaitingFix(WS, 10)).resolves.toMatchObject([{ failureClass: "code", reason: "" }])
    })
})
