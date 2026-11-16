import { Readable } from "node:stream"
import { Test } from "@nestjs/testing"
import { readConsoleLines, setConsoleExitCode } from "./cli-input.client"

/** Exposes the terminal adapter as one real provider in the Nest test graph. */
class ConsoleInputSubject {
    readonly lines = readConsoleLines
    readonly exit = setConsoleExitCode
}

describe("CLI input", () => {
    afterEach(() => {
        process.exitCode = undefined
        jest.restoreAllMocks()
    })

    it("reads an input line by line until it ends", async () => {
        const moduleRef = await Test.createTestingModule({ providers: [ConsoleInputSubject] }).compile()
        const input = moduleRef.get(ConsoleInputSubject)

        const lines: Array<string> = []
        for await (const line of input.lines(Readable.from(["first\nsec", "ond\n"]))) lines.push(line)

        expect(lines).toEqual(["first", "second"])
    })

    it("sets the exit code of the process", async () => {
        const moduleRef = await Test.createTestingModule({ providers: [ConsoleInputSubject] }).compile()

        moduleRef.get(ConsoleInputSubject).exit(3)

        expect(process.exitCode).toBe(3)
    })
})
