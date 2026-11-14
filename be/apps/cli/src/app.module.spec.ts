import { BrainFactEmbeddingsService, BrainFactsModule, FactVectorRowsService } from "@modules/domain/brain-facts"
import { VECTOR_INDEX } from "@modules/integrations/qdrant"
import { fakeOptionsOf, scanComposition, tokenNameOf } from "@tests/fixtures/builders/app-composition.builder"
import { AppModule } from "./app.module"
import { readCliEnv } from "./cli.env"
import { cliModules } from "./compose/modules"
import { cliSetupModules } from "./compose/setup"

// RULE (E-FIX10): a process composes the vector index only if it SEARCHES or EMBEDS. The cli only writes rows and sync jobs (base
// knowledge publish-only, brain derivations-only, brain-facts rows-only), so it boots without Qdrant and without `QDRANT_URL`. Every cli
// command is composed into ONE AppModule: one unresolved injection anywhere fails every command at boot (RESTART-R6: the full
// BrainFactsModule asked for the vector index and no command started).

/** The cli's options, read by its own env reader from a fake environment. */
const options = () => fakeOptionsOf(readCliEnv)

describe("the cli's composition (every command boots without a vector index)", () => {
    it("resolves every injection of every provider the cli composes", async () => {
        const scan = await scanComposition(AppModule.register(options()))

        expect(scan.unresolved).toEqual([])
        expect(scan.providers.length).toBeGreaterThan(500)
    })

    it("composes no vector index and none of the meaning half of the truth graph", async () => {
        const scan = await scanComposition(AppModule.register(options()))

        const meaning = new Set<unknown>([VECTOR_INDEX, BrainFactEmbeddingsService, FactVectorRowsService])

        expect(scan.modules).not.toContain("QdrantModule")
        expect(scan.providers.filter((token) => meaning.has(token)).map(tokenNameOf)).toEqual([])
    })

    it("exposing: the FULL truth graph composed beside the cli's modules asks for the vector index nothing provides", async () => {
        const read = options()
        const scan = await scanComposition({
            module: AppModule,
            imports: [...cliModules(read), ...cliSetupModules(read), BrainFactsModule.register({ isGlobal: true })],
        })

        expect(scan.unresolved).toEqual([expect.stringContaining(`BrainFactEmbeddingsService constructor[1]: ${tokenNameOf(VECTOR_INDEX)} not provided`)])
    })
})

describe("BrainFactsModule modes", () => {
    it("the rows-only mode registers and exports the rows without the meaning half", () => {
        const module = BrainFactsModule.register({ rowsOnly: true })

        expect(module.providers).not.toContain(BrainFactEmbeddingsService)
        expect(module.providers).not.toContain(FactVectorRowsService)
        expect(module.exports).not.toContain(BrainFactEmbeddingsService)
    })

    it("the full mode registers and exports the meaning half too", () => {
        const module = BrainFactsModule.register({})

        expect(module.providers).toEqual(expect.arrayContaining([BrainFactEmbeddingsService, FactVectorRowsService]))
        expect(module.exports).toEqual(expect.arrayContaining([BrainFactEmbeddingsService, FactVectorRowsService]))
    })
})
