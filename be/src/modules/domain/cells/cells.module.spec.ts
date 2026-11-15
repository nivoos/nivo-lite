import { Global, Module } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import {
    MemoryCellDefinitionsWriter,
    MemoryCellReader,
    ScriptedCellRunner,
    ScriptedCellToolDoor,
} from "@tests/fixtures/builders/cells.builder"
import { definitionOf, scopeOf } from "@tests/fixtures/builders/cells-executor.builder"
import { CLOCK } from "@modules/platform/clock"
import { LOGGER } from "@modules/platform/logging"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import type { CellExecutor } from "./cell-executor.port"
import { CellRunnerClient } from "./cell-runner.client"
import { CellSeedService } from "./cell-seed.service"
import { CellValidationService } from "./cell-validation.service"
import {
    CELL_DEFINITIONS_WRITER,
    CELL_EXECUTOR,
    CELL_LEDGER,
    CELL_METER,
    CELL_READER,
    CELL_RUNNER,
    CELLS_OPTIONS,
} from "./cells.decorators"
import { CellsError, CellsErrorCode } from "./errors/cells.error"
import type { CellsOptions } from "./cells.options"
import { CellsModule } from "./cells.module"
import { MemoryCellLedgerClient } from "./memory-cell-ledger.client"
import { MemoryCellMeterClient } from "./memory-cell-meter.client"

const options: CellsOptions = {
    runnerLimits: { memoryBytes: 1, stackBytes: 1, cpuMs: 1, wallMs: 1, outputBytes: 1, maxCalls: 1 },
    runnerPoolSize: 1,
    runnerEntry: "/nowhere/cell-runner/dist/main.js",
}

@Global()
@Module({
    providers: [
        { provide: CLOCK, useValue: { now: () => new Date("2026-11-15T00:00:00.000Z") } },
        { provide: LOGGER, useValue: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
        { provide: PRIMARY_ENTITY_MANAGER, useValue: {} },
    ],
    exports: [CLOCK, LOGGER, PRIMARY_ENTITY_MANAGER],
})
class PlatformDoubles {}

describe("CellsModule", () => {
    it("binds every port: the doubles given by value, the in-memory adapters by default, and runs a cell through the executor token", async () => {
        const reader = new MemoryCellReader()
        reader.addDefinition(definitionOf({ kind: "tool", key: "demo.ping", version: 1 }))
        const door = new ScriptedCellToolDoor({ "demo.ping": { ok: true, value: { pong: true } } })
        const writer = new MemoryCellDefinitionsWriter()
        const moduleRef = await Test.createTestingModule({
            imports: [
                PlatformDoubles,
                CellsModule.register(options, { reader, writer, runner: new ScriptedCellRunner(), toolDoor: door }),
            ],
        }).compile()
        expect(moduleRef.get(CELL_READER, { strict: false })).toBe(reader)
        expect(moduleRef.get(CELL_DEFINITIONS_WRITER, { strict: false })).toBe(writer)
        expect(moduleRef.get(CELL_LEDGER, { strict: false })).toBeInstanceOf(MemoryCellLedgerClient)
        expect(moduleRef.get(CELL_METER, { strict: false })).toBeInstanceOf(MemoryCellMeterClient)
        const executor = moduleRef.get<CellExecutor>(CELL_EXECUTOR, { strict: false })
        const result = await executor.execute({
            scope: scopeOf(),
            cell: { kind: "tool", key: "demo.ping", version: 1 },
            input: {},
        })
        expect(result.outcome).toEqual({ kind: "ok", output: { pong: true } })
    })

    it("lets a later migration step bind the ledger and the meter by value", async () => {
        const ledger = new MemoryCellLedgerClient()
        const meter = new MemoryCellMeterClient()
        const moduleRef = await Test.createTestingModule({
            imports: [
                PlatformDoubles,
                CellsModule.register(options, {
                    reader: new MemoryCellReader(),
                    writer: new MemoryCellDefinitionsWriter(),
                    runner: new ScriptedCellRunner(),
                    toolDoor: new ScriptedCellToolDoor(),
                    ledger,
                    meter,
                }),
            ],
        }).compile()
        expect(moduleRef.get(CELL_LEDGER, { strict: false })).toBe(ledger)
        expect(moduleRef.get(CELL_METER, { strict: false })).toBe(meter)
    })

    it("binds the real runner client from the options, the validation and the seed by default, and the options under their token", async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                PlatformDoubles,
                CellsModule.register(options, {
                    reader: new MemoryCellReader(),
                    writer: new MemoryCellDefinitionsWriter(),
                    toolDoor: new ScriptedCellToolDoor(),
                }),
            ],
        }).compile()
        expect(moduleRef.get(CELL_RUNNER, { strict: false })).toBeInstanceOf(CellRunnerClient)
        expect(moduleRef.get(CellValidationService, { strict: false })).toBeInstanceOf(CellValidationService)
        expect(moduleRef.get(CellSeedService, { strict: false })).toBeInstanceOf(CellSeedService)
        expect(moduleRef.get(CELLS_OPTIONS, { strict: false })).toMatchObject(options)
    })

    it("refuses at registration, typed, a module that executes cells without a tool door (phase 0 has no default door)", () => {
        const register = (): unknown => CellsModule.register(options, { reader: new MemoryCellReader() })
        expect(register).toThrow(CellsError)
        expect(register).toThrow(expect.objectContaining({ code: CellsErrorCode.ToolDoorMissing }))
    })

    it("a seed-only module needs no tool door and binds no executor", async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                PlatformDoubles,
                CellsModule.register(
                    { ...options, seedOnly: true },
                    {
                        reader: new MemoryCellReader(),
                        writer: new MemoryCellDefinitionsWriter(),
                        runner: new ScriptedCellRunner(),
                    },
                ),
            ],
        }).compile()
        expect(moduleRef.get(CellSeedService, { strict: false })).toBeInstanceOf(CellSeedService)
        expect(() => moduleRef.get(CELL_EXECUTOR, { strict: false })).toThrow()
    })
})
