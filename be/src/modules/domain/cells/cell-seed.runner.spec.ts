import { resolve } from "node:path"
import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { EntityManager } from "typeorm"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { FIXTURE_PACKAGES, edited, packageFiles } from "@tests/fixtures/builders/cells-seed.builder"
import { MemoryCellDefinitionsWriter } from "@tests/fixtures/builders/cells.builder"
import { CELL_DEFINITIONS_WRITER, CELL_RUNNER } from "./cells.decorators"
import { CellRunnerClient, readDirsOf } from "./cell-runner.client"
import { CellSeedService } from "./cell-seed.service"
import { CellValidationService } from "./cell-validation.service"

/*
 * `cells-seed check` over both fixture packages with the REAL isolated runner (packages/cell-runner/dist/main.js, QuickJS) judging the sources:
 * the join of slice S2 with slice S3. The writer and the database stay doubles (the seed writes nothing in a check).
 */

const ENTRY = resolve(__dirname, "../../../../../packages/cell-runner/dist/main.js")
const LIMITS = { memoryBytes: 64 * 1024 * 1024, stackBytes: 1024 * 1024, cpuMs: 2000, wallMs: 8000, outputBytes: 4096, maxCalls: 5 }

describe("cells-seed check with the real runner", () => {
    const runner = new CellRunnerClient({ limits: LIMITS, poolSize: 1, entry: ENTRY, readDirs: readDirsOf(ENTRY) })

    afterAll(() => {
        runner.onModuleDestroy()
    })

    const seedOver = async (): Promise<CellSeedService> => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                CellSeedService,
                CellValidationService,
                { provide: PRIMARY_ENTITY_MANAGER, useValue: mock<EntityManager>() },
                { provide: CELL_DEFINITIONS_WRITER, useValue: new MemoryCellDefinitionsWriter() },
                { provide: CELL_RUNNER, useValue: runner },
            ],
        }).compile()
        return moduleRef.get(CellSeedService)
    }

    it.each(FIXTURE_PACKAGES)("%s: every source parses in QuickJS and the check prints READY", async (name) => {
        const view = await (await seedOver()).check(packageFiles(name))

        expect(view.lines.at(-1)).toBe("READY")
    })

    it("a source QuickJS cannot parse is refused CELLS_SOURCE_SYNTAX by the real runner", async () => {
        const files = edited(packageFiles("demo-money"), "cells/trigger/demo.bank-credit/v1/translate.js", (text) => `${text}\nfunction broken( {\n`)

        const view = await (await seedOver()).check(files)

        expect(view.lines.some((line) => line.startsWith("refused trigger:demo.bank-credit@1 CELLS_SOURCE_SYNTAX"))).toBe(true)
    })
})
