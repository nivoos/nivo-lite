import { Readable } from "node:stream"
import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { SetSeedService } from "@modules/domain/workspace-seed"
import { SetSeedService as SetSeedServiceToken } from "@modules/domain/workspace-seed"
import { SeedSetCli } from "./seed-set.cli"
import { SetDoorsCli } from "./subs/doors.cli"
import { SetResetCli } from "./subs/reset.cli"
import { SetRunCli } from "./subs/run.cli"

// The work is the set seed's (specs next to it); the groups of this folder only read stdin and the flags and hand them over.
jest.mock("@modules/domain/workspace-seed", () => ({ SetSeedService: class {} }))

const withStdin = (text: string): void => {
    const chunks = Readable.from([text])
    const stdin = mock<typeof process.stdin>({ [Symbol.asyncIterator]: () => chunks[Symbol.asyncIterator]() })
    jest.spyOn(process, "stdin", "get").mockReturnValue(stdin)
}

const commandOf = async <T>(command: new (seed: SetSeedService) => T): Promise<{ readonly command: T; readonly seed: ReturnType<typeof mock<SetSeedService>> }> => {
    const seed = mock<SetSeedService>()
    seed.run.mockResolvedValue(undefined)
    seed.doors.mockResolvedValue(undefined)
    seed.reset.mockResolvedValue(undefined)
    const moduleRef = await Test.createTestingModule({ providers: [command, { provide: SetSeedServiceToken, useValue: seed }] }).compile()
    return { command: moduleRef.get(command), seed }
}

describe("the seed-set commands", () => {
    afterEach(() => {
        jest.restoreAllMocks()
    })

    it("run: hands the whole of stdin, the environment and the dry and bind choices to the set seed once", async () => {
        withStdin('{"documents":[]}\n')
        const { command, seed } = await commandOf(SetRunCli)

        await command.run([], { env: command.parseEnv("dev"), dry: command.parseDry(), bind: command.parseBind() })

        expect(seed.run.mock.calls).toEqual([['{"documents":[]}\n', "dev", { dry: true, bind: true }]])
    })

    it("doors: hands stdin and the environment to the set seed", async () => {
        withStdin("{}")
        const { command, seed } = await commandOf(SetDoorsCli)

        await command.run([], { env: command.parseEnv("dev") })

        expect(seed.doors.mock.calls).toEqual([["{}", "dev"]])
    })

    it("reset: hands stdin, the environment and the execute choice to the set seed", async () => {
        withStdin("{}")
        const { command, seed } = await commandOf(SetResetCli)

        await command.run([], { env: command.parseEnv("dev"), execute: command.parseExecute() })

        expect(seed.reset.mock.calls).toEqual([["{}", "dev", true]])
    })

    it("the group shows its help and runs nothing else when no sub-command is named", async () => {
        const moduleRef = await Test.createTestingModule({ providers: [SeedSetCli] }).compile()
        const group = moduleRef.get(SeedSetCli)
        const help = jest.fn()
        Object.defineProperty(group, "command", { value: { help } })

        await expect(Promise.resolve(group.run())).resolves.toBeUndefined()

        expect(help).toHaveBeenCalledTimes(1)
    })
})
