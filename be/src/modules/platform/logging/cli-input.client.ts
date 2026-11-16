import type { Readable } from "node:stream"
import { createInterface } from "node:readline"

/** The lines of an input (stdin by default), one at a time, until it ends. */
export const readConsoleLines = (input: Readable = process.stdin): AsyncIterable<string> =>
    createInterface({ input, crlfDelay: Infinity })

/** Sets the exit code the process ends with. */
export const setConsoleExitCode = (code: number): void => {
    process.exitCode = code
}
