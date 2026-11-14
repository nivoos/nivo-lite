import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { CellSeedService } from "@modules/domain/cells"
import { PackageFolderClient } from "../package-folder.client"
import { CellsSeedApplyCli } from "./apply.cli"

jest.mock("@modules/domain/cells", () => ({ CellSeedService: class {} }))

const build = async (ready: boolean) => {
    const seed = mock<CellSeedService>()
    seed.apply.mockResolvedValue({ ready, lines: ["p@1.0.0 at abc", "applied"] })
    const folder = mock<PackageFolderClient>()
    folder.read.mockResolvedValue(new Map([["cells.package.yaml", "x"]]))
    const moduleRef = await Test.createTestingModule({
        providers: [CellsSeedApplyCli, { provide: CellSeedService, useValue: seed }, { provide: PackageFolderClient, useValue: folder }],
    }).compile()
    return { command: moduleRef.get(CellsSeedApplyCli), seed }
}

describe("cells-seed apply", () => {
    afterEach(() => {
        jest.restoreAllMocks()
        process.exitCode = 0
    })

    it("hands the folder files, the pin, the force and the dry choice to the seed once and prints its lines", async () => {
        const write = jest.spyOn(process.stdout, "write").mockReturnValue(true)
        const { command, seed } = await build(true)

        await command.run([], {
            dir: command.parseDir("pkg"),
            repository: command.parseRepository("file:r"),
            commit: command.parseCommit("abc"),
            force: command.parseForce(),
            dryRun: command.parseDryRun(),
        })

        expect(seed.apply.mock.calls).toEqual([[{ files: new Map([["cells.package.yaml", "x"]]), origin: { repository: "file:r", commit: "abc" }, force: true, dry: true }]])
        expect(write).toHaveBeenCalledWith("p@1.0.0 at abc\napplied\n")
        expect(process.exitCode).toBe(0)
    })

    it("exits non-zero when something is refused", async () => {
        jest.spyOn(process.stdout, "write").mockReturnValue(true)
        const { command } = await build(false)

        await command.run([], { dir: "d", repository: "r", commit: "c", force: false, dryRun: false })

        expect(process.exitCode).toBe(1)
    })
})
