import { Module, type DynamicModule, type Provider } from "@nestjs/common"
import { BrainChangeRequestsService } from "./brain-change-requests.service"
import { BrainFactAreasService } from "./brain-fact-areas.service"
import { BrainFactBatchService } from "./brain-fact-batch.service"
import { BrainFactEmbeddingsService } from "./brain-fact-embeddings.service"
import { FactVectorRowsService } from "./fact-vector-rows.service"
import { BrainFactRelationsService } from "./brain-fact-relations.service"
import { BrainFactsMaintenanceService } from "./brain-facts-maintenance.service"
import { BrainFactsPagingService } from "./brain-facts-paging.service"
import { BrainFactsReadService } from "./brain-facts-read.service"
import { BrainFactsService } from "./brain-facts.service"
import { InForceBoundService } from "./in-force-bound.service"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./brain-facts.module-definition"

/** The rows of the truth graph: every reader and writer that needs no vector index. */
const ROW_PROVIDERS: ReadonlyArray<Provider> = [
    BrainFactsService,
    BrainFactAreasService,
    InForceBoundService,
    BrainFactsReadService,
    BrainFactsPagingService,
    BrainFactsMaintenanceService,
    BrainFactBatchService,
    BrainFactRelationsService,
    BrainChangeRequestsService,
]

/** What the rows half exports. */
const ROW_EXPORTS = [
    BrainFactsService,
    BrainFactAreasService,
    BrainFactsReadService,
    BrainFactsPagingService,
    BrainFactBatchService,
    BrainFactRelationsService,
    BrainChangeRequestsService,
]

/** The meaning half: the facts' search through the vector index, and the rows the vector sync compares with it. */
const MEANING_PROVIDERS = [BrainFactEmbeddingsService, FactVectorRowsService]

@Module({})
/** What is true about a business: the truth graph agents answer from, its facts with source, trust, validity and version, and their relations. */
export class BrainFactsModule extends ConfigurableModuleClass {
    /** Registers the capability once per app; the rows-only mode (cli) registers the rows without the meaning half (no vector index). */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        const meaning = options.rowsOnly === true ? [] : MEANING_PROVIDERS
        return {
            ...base,
            providers: [...(base.providers ?? []), ...ROW_PROVIDERS, ...meaning],
            exports: [...ROW_EXPORTS, ...meaning],
        }
    }
}
