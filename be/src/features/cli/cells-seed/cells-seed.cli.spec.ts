import { Test } from "@nestjs/testing"
import { CellsSeedCli } from "./cells-seed.cli"

describe("cells-seed group", () => {
    it("without a sub-command it shows its help", async () => {
        const moduleRef = await Test.createTestingModule({ providers: [CellsSeedCli] }).compile()
        const command = moduleRef.get(CellsSeedCli)
        const help = jest.fn().mockResolvedValue(undefined)
        Object.assign(command, { command: { help } })

        await command.run()

        expect(help).toHaveBeenCalledTimes(1)
    })
})
