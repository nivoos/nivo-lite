import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { DossierReviewRunsService } from "@modules/domain/dossier-review"
import { DocumentReviewService } from "./document-review.service"

const WS = "11111111-1111-4111-8111-111111111111"
const SOURCE = "22222222-2222-4222-8222-222222222222"

const build = async () => {
    const reviews = mock<DossierReviewRunsService>()
    const moduleRef = await Test.createTestingModule({
        providers: [DocumentReviewService, { provide: DossierReviewRunsService, useValue: reviews }],
    }).compile()
    return { service: moduleRef.get(DocumentReviewService), reviews }
}

describe("DocumentReviewService", () => {
    describe("requestForSource", () => {
        it("asks the critic to read the source once", async () => {
            const { service, reviews } = await build()

            await service.requestForSource(WS, SOURCE)

            expect(reviews.requestForSource).toHaveBeenCalledTimes(1)
            expect(reviews.requestForSource).toHaveBeenCalledWith(WS, SOURCE, {})
        })

        it("passes a resume of the upkeep tick through", async () => {
            const { service, reviews } = await build()

            await service.requestForSource(WS, SOURCE, { resume: true })

            expect(reviews.requestForSource).toHaveBeenCalledWith(WS, SOURCE, { resume: true })
        })

        it("throws a failed request: the job that asked is judged by the runner, nothing is swallowed here", async () => {
            const { service, reviews } = await build()
            const cause = new Error("queue down")
            reviews.requestForSource.mockRejectedValue(cause)

            await expect(service.requestForSource(WS, SOURCE)).rejects.toBe(cause)
        })
    })

    describe("requestForGoneSource", () => {
        it("lets the critic forget a deleted source", async () => {
            const { service, reviews } = await build()

            await service.requestForGoneSource(WS, SOURCE)

            expect(reviews.requestForGoneSource).toHaveBeenCalledWith(WS, SOURCE)
        })

        it("throws a failed request", async () => {
            const { service, reviews } = await build()
            const cause = new Error("queue down")
            reviews.requestForGoneSource.mockRejectedValue(cause)

            await expect(service.requestForGoneSource(WS, SOURCE)).rejects.toBe(cause)
        })
    })
})
