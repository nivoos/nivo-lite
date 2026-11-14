import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { CellSeedService } from "@modules/domain/cells"
import { PackageFolderClient } from "../package-folder.client"
import { CellsSeedCheckCli } from "./check.cli"

jest.mock("@modules/domain/cells", () => ({ CellSeedService: class {} }))

const build = async (ready: boolean) => {
    const seed = mock<CellSeedService>()
    seed.check.mockResolvedValue({ ready, lines: ["p@1.0.0", ready ? "READY" : "NOT READY: 1 refused"] })
    const folder = mock<PackageFolderClient>()
    folder.read.mockResolvedValue(new Map([["cells.package.yaml", "x"]]))
    const moduleRef = await Test.createTestingModule({
        providers: [CellsSeedCheckCli, { provide: CellSeedService, useValue: seed }, { provide: PackageFolderClient, useValue: folder }],
    }).compile()
    return { command: moduleRef.get(CellsSeedCheckCli), seed, folder }
}

describe("cells-seed check", () => {
    afterEach(() => {
        jest.restoreAllMocks()
        process.exitCode = 0
    })

    it("reads the folder, hands its files to the check, prints the lines and exits 0 when READY", async () => {
        const write = jest.spyOn(process.stdout, "write").mockReturnValue(true)
        const { command, seed, folder } = await build(true)

        await command.run([], { dir: command.parseDir("pkg") })

        expect(folder.read.mock.calls).toEqual([["pkg"]])
        expect(seed.check.mock.calls).toEqual([[new Map([["cells.package.yaml", "x"]])]])
        expect(write).toHaveBeenCalledWith("p@1.0.0\nREADY\n")
        expect(process.exitCode).toBe(0)
    })

    it("exits non-zero when something is refused", async () => {
        jest.spyOn(process.stdout, "write").mockReturnValue(true)
        const { command } = await build(false)

        await command.run([], { dir: "pkg" })

        expect(process.exitCode).toBe(1)
    })
})
