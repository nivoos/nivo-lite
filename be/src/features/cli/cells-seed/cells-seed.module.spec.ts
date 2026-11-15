import { resolve } from "node:path"
import { Global, Module } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { CellsModule, parseCellsConfig } from "@modules/domain/cells"
import { CLOCK } from "@modules/platform/clock"
import { EnvSource } from "@modules/platform/config"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { LOGGER } from "@modules/platform/logging"
import { CellsSeedModule } from "./cells-seed.module"
import { CellsSeedCheckCli } from "./subs/check.cli"

/** What the cli app gives every group: the clock, the logger and the database manager (the check never touches it). */
@Global()
@Module({
    providers: [
        { provide: CLOCK, useValue: { now: () => new Date("2026-11-15T00:00:00.000Z") } },
        { provide: LOGGER, useValue: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
        { provide: PRIMARY_ENTITY_MANAGER, useValue: {} },
    ],
    exports: [CLOCK, LOGGER, PRIMARY_ENTITY_MANAGER],
})
class CliPlatform {}

const FIXTURES = resolve(__dirname, "../../../tests/fixtures/cells")

describe("cells-seed wired as the cli composes it", () => {
    afterEach(() => {
        jest.restoreAllMocks()
        process.exitCode = 0
    })

    it.each(["demo-money", "demo-crm-lead"])(
        "%s: CellsModule seed-only (options read from the environment, the REAL isolated runner) and the group resolve; check prints READY",
        async (name) => {
            const write = jest.spyOn(process.stdout, "write").mockReturnValue(true)
            const moduleRef = await Test.createTestingModule({
                imports: [
                    CliPlatform,
                    CellsModule.register({ isGlobal: true, ...parseCellsConfig(new EnvSource({})), seedOnly: true }),
                    CellsSeedModule.register({}),
                ],
            }).compile()
            try {
                await moduleRef.get(CellsSeedCheckCli).run([], { dir: resolve(FIXTURES, name) })

                const printed = String(write.mock.calls.map(([text]) => text).join(""))
                expect(printed.split("\n").at(-2)).toBe("READY")
                expect(process.exitCode).toBe(0)
            } finally {
                await moduleRef.close()
            }
        },
        120_000,
    )
})
