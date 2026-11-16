import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { DataStoreServeService } from "@modules/domain/data-stores"
import { DataStoreCli } from "./data-store.cli"

describe("DataStoreCli", () => {
    it("serves the named store with the verb and its arguments", async () => {
        const serving = mock<DataStoreServeService>()
        const moduleRef = await Test.createTestingModule({
            providers: [DataStoreCli, { provide: DataStoreServeService, useValue: serving }],
        }).compile()

        const finished = await moduleRef.get(DataStoreCli).run(["storage-all", "export", '{"sets":["media"]}'])

        expect(finished).toBeUndefined()
        expect(serving.serveOnConsole).toHaveBeenCalledWith("storage-all", ["export", '{"sets":["media"]}'])
    })

    it("serves an unnamed store as the empty id, which the capability refuses", async () => {
        const serving = mock<DataStoreServeService>()
        const moduleRef = await Test.createTestingModule({
            providers: [DataStoreCli, { provide: DataStoreServeService, useValue: serving }],
        }).compile()

        const finished = await moduleRef.get(DataStoreCli).run([])

        expect(finished).toBeUndefined()
        expect(serving.serveOnConsole).toHaveBeenCalledWith("", [])
    })
})
