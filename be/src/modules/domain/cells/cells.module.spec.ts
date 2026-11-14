import { Global, Module } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { MemoryCellDefinitionsWriter, MemoryCellReader, ScriptedCellRunner, ScriptedCellToolDoor } from "@tests/fixtures/builders/cells.builder"
import { definitionOf, scopeOf } from "@tests/fixtures/builders/cells-executor.builder"
import { CLOCK } from "@modules/platform/clock"
import { LOGGER } from "@modules/platform/logging"
import type { CellExecutor } from "./cell-executor.port"
import { CELL_DEFINITIONS_WRITER, CELL_EXECUTOR, CELL_LEDGER, CELL_METER, CELL_READER } from "./cells.decorators"
import type { CellsOptions } from "./cells.options"
import { CellsModule } from "./cells.module"
import { MemoryCellLedgerClient } from "./memory-cell-ledger.client"
import { MemoryCellMeterClient } from "./memory-cell-meter.client"

const options: CellsOptions = {
    runnerLimits: { memoryBytes: 1, stackBytes: 1, cpuMs: 1, wallMs: 1, outputBytes: 1, maxCalls: 1 },
    runnerPoolSize: 1,
}

@Global()
@Module({
    providers: [
        { provide: CLOCK, useValue: { now: () => new Date("2026-11-15T00:00:00.000Z") } },
        { provide: LOGGER, useValue: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    ],
    exports: [CLOCK, LOGGER],
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
        const result = await executor.execute({ scope: scopeOf(), cell: { kind: "tool", key: "demo.ping", version: 1 }, input: {} })
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
})
