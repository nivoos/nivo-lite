import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { blobEntry, memoryStore } from "@modules/integrations/seed"
import { DataStoreServeService } from "./data-store-serve.service"
import { DATA_STORES, DATA_STORE_CONSOLE } from "./data-stores.decorators"
import type { DataStoreConsole } from "./data-stores.options"

const bytes = (...values: ReadonlyArray<number>): Uint8Array => new Uint8Array(values)

/** One entry as a protocol line: a blob travels as base64 with its sha256. */
const lineOf = (set: string, key: string, body: Uint8Array, media: string): string =>
    JSON.stringify({
        set,
        key,
        form: "blob",
        media,
        sha256: blobEntry(set, key, body, media).sha256,
        body: Buffer.from(body).toString("base64"),
    })

/** A service over one memory storage store and a console that reads `input` and records what it prints. */
const build = async (input: ReadonlyArray<string> = []) => {
    const store = memoryStore({
        id: "storage-all",
        kind: "storage",
        sets: { records: { "ws/a": bytes(1, 2) } },
    })
    const console = mock<DataStoreConsole>()
    console.lines.mockImplementation(() =>
        (async function* () {
            await Promise.resolve()
            yield* input
        })(),
    )
    const moduleRef = await Test.createTestingModule({
        providers: [
            DataStoreServeService,
            { provide: DATA_STORES, useValue: [store] },
            { provide: DATA_STORE_CONSOLE, useValue: console },
        ],
    }).compile()
    const printed = (): ReadonlyArray<string> => console.print.mock.calls.map(([line]) => line)
    return { service: moduleRef.get(DataStoreServeService), console, printed }
}

describe("DataStoreServeService: one store over the line protocol", () => {
    it("describes the store in one line and leaves stdin unopened", async () => {
        const { service, console, printed } = await build()

        await service.serveOnConsole("storage-all", ["describe"])

        expect(printed()).toHaveLength(1)
        expect(printed()[0]).toContain('"canExport":true')
        expect(printed()[0]).toContain('"set":"records"')
        expect(console.lines).not.toHaveBeenCalled()
        expect(console.exit).not.toHaveBeenCalled()
    })

    it("exports one line per entry and the end line with the count", async () => {
        const { service, printed } = await build()

        await service.serveOnConsole("storage-all", ["export", "{}"])

        expect(printed()).toHaveLength(2)
        expect(printed()[0]).toContain('"key":"ws/a"')
        expect(printed()[1]).toBe('{"end":true,"items":1}')
    })

    it("imports the entry lines of the input and answers the report", async () => {
        const first = await build([lineOf("records", "n/new", bytes(4), "image/png")])
        const second = await build([lineOf("records", "ws/a", bytes(1, 2), "application/octet-stream")])
        const options = JSON.stringify({ dryRun: false, mode: "merge" })

        await first.service.serveOnConsole("storage-all", ["import", options])
        await second.service.serveOnConsole("storage-all", ["import", options])

        expect(first.printed()[0]).toContain('"outcome":"applied"')
        expect(second.printed()[0]).toContain('"outcome":"unchanged"')
    })

    it("answers the identity of a held key", async () => {
        const { service, printed } = await build()

        await service.serveOnConsole("storage-all", ["identity", "records", "ws/a"])

        expect(printed()).toHaveLength(1)
        expect(printed()[0]).toContain('"identity"')
    })

    it("names the stores it has when the store is unknown, and sets the exit code", async () => {
        const { service, console, printed } = await build()

        await service.serveOnConsole("nothing", ["describe"])

        expect(printed()).toEqual(['{"error":"DATA_STORE_UNKNOWN","store":"nothing","stores":["storage-all"]}'])
        expect(console.exit).toHaveBeenCalledWith(3)
    })

    it("answers a usage error and exit code 2 for a verb it does not serve", async () => {
        const { service, console, printed } = await build()

        await service.serveOnConsole("storage-all", ["drop"])

        expect(printed()[0]).toContain('"error":"DATA_PROTOCOL_USAGE"')
        expect(console.exit).toHaveBeenCalledWith(2)
    })
})
