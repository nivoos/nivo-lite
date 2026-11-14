import { createLoop } from "./protocol-loop"
import type { RunnerOutbound } from "./protocol"

/*
 * The runner process (CELLS-PLAN 4.2). Started by the api-side client with an empty environment and Node's permission flags. It serves ONE request
 * (a `run` or a `check`) and exits: a process never serves two sources. Everything it receives is JSON lines on stdin; everything it says is JSON lines on stdout.
 */

// the guest's local time is UTC whatever the host's zone is, so a replay on another host reads the same wall clock (this is the child's own variable, set by itself)
process.env.TZ = "UTC"

const send = (message: RunnerOutbound): void => {
    process.stdout.write(`${JSON.stringify(message)}\n`)
}

const finish = (): void => {
    // let the last line leave before the process ends
    process.stdout.write("", () => process.exit(0))
}

const loop = createLoop({ send, finish })

process.on("uncaughtException", () => {
    process.exit(1)
})
process.on("unhandledRejection", () => {
    process.exit(1)
})

let buffered = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
    buffered += chunk
    for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
        loop.line(buffered.slice(0, end))
        buffered = buffered.slice(end + 1)
    }
})
process.stdin.on("end", () => loop.closed())
