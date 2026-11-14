import { Injectable } from "@nestjs/common"
import { DossierReviewRunsService } from "@modules/domain/dossier-review"

@Injectable()
/** Asks the shop-document critic to read a document; a failure is thrown, so the job that asked (the facts job) is judged by the runner. */
export class DocumentReviewService {
    constructor(private readonly reviews: DossierReviewRunsService) {}

    /**
     * A document was read or given up on: its critique waits for a run, in the background (no truth waits for it). `{ resume: true }`
     * goes on with a critique that stopped for credits or the bound of calls (`DossierReviewRunsService.requestForSource`).
     * The truths tick no longer asks for it (no reading waits for a critique).
     */
    requestForSource(workspaceId: string, sourceId: string, how: { readonly resume?: boolean } = {}): Promise<void> {
        return this.reviews.requestForSource(workspaceId, sourceId, how)
    }

    /** A document was deleted: its critique and its open points go with it. */
    requestForGoneSource(workspaceId: string, sourceId: string): Promise<void> {
        return this.reviews.requestForGoneSource(workspaceId, sourceId)
    }
}
