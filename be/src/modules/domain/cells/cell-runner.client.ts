import { spawn, type ChildProcessByStdio } from "node:child_process"
import type { Socket } from "node:net"
import type { Readable, Writable } from "node:stream"
import { sha256Of } from "./cell-hash.policy"
import type { CellRunner, RunnerDoor } from "./cell-runner.port"
import type {
    CellKind,
    JsonValue,
    RunnerCapability,
    RunnerInbound,
    RunnerLimits,
    RunnerOutbound,
    RunnerRunRequest,
    RunnerRunResult,
} from "./cells.contracts"
import { CellsError, CellsErrorCode } from "./errors/cells.error"

/** How the client starts the runner process. `readDirs` are the only places the child may read (`--allow-fs-read`), with a trailing slash. */
export interface CellRunnerClientOptions {
    /** The ceiling of every limit; a request may only go lower. */
    readonly limits: RunnerLimits
    /** At most this many runner processes alive at once (running plus warm spares). */
    readonly poolSize: number
    /** The runner's compiled entry (`packages/cell-runner/dist/main.js`). */
    readonly entry: string
    /** Directories the child may read: its own `dist` and the WebAssembly engine packages. */
    readonly readDirs: ReadonlyArray<string>
    /** The node binary; the current one when absent. */
    readonly nodeBinary?: string
    /** The old space of the child's host engine in MB (the WebAssembly memory is limited separately by `memoryBytes`). */
    readonly heapMb?: number
    /** The process starter; Node's `spawn` when absent (a spec passes a recording wrapper to see the options that reach it). */
    readonly spawnProcess?: typeof spawn
}

/** The capabilities each cell kind is offered. Phase 0 has `tool` only; a provider will add `http` and small crypto here, and nowhere else. */
export const CAPABILITIES_BY_KIND: Readonly<Partial<Record<CellKind, ReadonlyArray<RunnerCapability>>>> = {
    node: ["tool"],
    tool: ["tool"],
    operation: [],
    trigger: [],
    provider: ["tool"],
}

const capabilitiesOf = (request: RunnerRunRequest): ReadonlyArray<RunnerCapability> =>
    request.cellKind === undefined
        ? request.entry === "run"
            ? ["tool"]
            : []
        : (CAPABILITIES_BY_KIND[request.cellKind] ?? [])

type RunnerChild = ChildProcessByStdio<Writable, Readable, Readable>

const MAX_TOOL_NAME_CHARS = 200
const MAX_DETAIL_CHARS = 500
const FAILURE_KINDS: ReadonlyArray<string> = ["limits", "thrown", "syntax", "output"]
const MESSAGE_ROOM_BYTES = 1024 * 1024
const CHECK_WALL_MS = 10_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const clip = (text: string): string => (text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}...` : text)

const lowest = (asked: number, ceiling: number): number =>
    Number.isFinite(asked) && asked > 0 ? Math.min(asked, ceiling) : ceiling

/** Each limit of a request, held to the ceiling of the client: a cell row may only go lower. */
export const limitsHeldTo = (asked: RunnerLimits, ceiling: RunnerLimits): RunnerLimits => ({
    memoryBytes: lowest(asked.memoryBytes, ceiling.memoryBytes),
    stackBytes: lowest(asked.stackBytes, ceiling.stackBytes),
    cpuMs: lowest(asked.cpuMs, ceiling.cpuMs),
    wallMs: lowest(asked.wallMs, ceiling.wallMs),
    outputBytes: lowest(asked.outputBytes, ceiling.outputBytes),
    maxCalls: lowest(asked.maxCalls, ceiling.maxCalls),
})

const dirOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, "")

const packageRootOf = (resolvedFile: string, name: string): string => {
    const normalized = resolvedFile.replaceAll("\\", "/")
    const marker = `node_modules/${name}`
    const at = normalized.lastIndexOf(marker)
    return at < 0 ? dirOf(normalized) : normalized.slice(0, at + marker.length)
}

const ENGINE_PACKAGES: ReadonlyArray<string> = [
    "quickjs-emscripten",
    "quickjs-emscripten-core",
    "@jitl/quickjs-ffi-types",
    "@jitl/quickjs-wasmfile-debug-asyncify",
    "@jitl/quickjs-wasmfile-debug-sync",
    "@jitl/quickjs-wasmfile-release-asyncify",
    "@jitl/quickjs-wasmfile-release-sync",
]

/**
 * The read set of a runner entry: its own folder and the folder of each WebAssembly engine package, resolved from the entry the way Node resolves
 * them for the child. Nothing else is readable by the child. A package the install does not have is left out (the child then fails typed at load).
 */
export const readDirsOf = (entry: string): ReadonlyArray<string> => {
    const from = dirOf(entry)
    const dirs = [`${from.replaceAll("\\", "/")}/`]
    let base = from
    for (const name of ENGINE_PACKAGES) {
        try {
            const root = packageRootOf(require.resolve(name, { paths: [base] }), name)
            dirs.push(`${root}/`)
            base = root
        } catch {
            // a missing optional variant is simply not granted
        }
    }
    return dirs
}

/**
 * The command, arguments and spawn options of a runner process. Pure, so a spec can inspect them: the environment is EMPTY, the permission model is on,
 * the pipes are the only channel, and on Windows the child opens no console window (`windowsHide`), attached to the api (`detached: false`).
 */
export const spawnPlanOf = (
    options: Pick<CellRunnerClientOptions, "entry" | "readDirs" | "nodeBinary" | "heapMb">,
): {
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly spawnOptions: {
        readonly env: Record<string, never>
        readonly cwd: string
        readonly stdio: ["pipe", "pipe", "pipe"]
        readonly windowsHide: true
        readonly detached: false
    }
} => ({
    command: options.nodeBinary ?? process.execPath,
    args: [
        "--permission",
        ...options.readDirs.map((dir) => `--allow-fs-read=${dir}`),
        `--max-old-space-size=${String(options.heapMb ?? 256)}`,
        "--disallow-code-generation-from-strings",
        options.entry,
    ],
    spawnOptions: {
        env: {},
        cwd: dirOf(options.entry),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached: false,
    },
})

/** What one live runner process is to the client. */
interface Slot {
    readonly child: RunnerChild
    alive: boolean
}

/**
 * The api-side client of the isolated runner (CELLS-PLAN 4). Every authority is here, none in the child:
 *  - the source hash is verified before anything starts;
 *  - the child is started with an EMPTY environment, Node's permission flags (only the read set), and serves one request;
 *  - a tool call of the source is forwarded to the door only when the cell declared the tool; an undeclared tool ends the run with `CELLS_TOOL_UNDECLARED`;
 *  - the wall clock (paused during door calls) kills the child; every message from the child is untrusted JSON, size-bounded and shape-checked.
 * Guest outcomes come back as `done`, `ended` or `failed` (limits, thrown, syntax, output). A client-side refusal or a broken child rejects with a `CellsError`:
 * `CELLS_TOOL_UNDECLARED`, `CELLS_SOURCE_HASH_MISMATCH`, `CELLS_RUNNER_CRASHED`.
 */
export class CellRunnerClient implements CellRunner {
    private readonly spares: Slot[] = []
    private readonly waiters: Array<() => void> = []
    private active = 0
    private warm = false
    private closed = false
    private nextId = 1

    constructor(private readonly options: CellRunnerClientOptions) {}

    /** Starts the warm spares: the first run does not pay the start of the process. */
    warmUp(): void {
        this.warm = true
        this.refill()
    }

    /** Ends every runner process; a later run starts none. */
    onModuleDestroy(): void {
        this.closed = true
        for (const slot of this.spares.splice(0)) this.kill(slot)
    }

    async run(request: RunnerRunRequest, door: RunnerDoor): Promise<RunnerRunResult> {
        if (sha256Of(request.source) !== request.sha256) {
            throw new CellsError({ code: CellsErrorCode.SourceHashMismatch, params: { sha256: request.sha256 } })
        }
        const limits = limitsHeldTo(request.limits, this.options.limits)
        const message: RunnerInbound = {
            type: "run",
            id: this.id(),
            entry: request.entry,
            source: request.source,
            sha256: request.sha256,
            input: request.input,
            facts: request.facts,
            limits,
            capabilities: capabilitiesOf(request),
        }
        const declared = new Set(request.declaredTools ?? [])
        const result = await this.withSlot((slot) => this.converse(slot, message, limits, declared, door))
        if (result.type === "checked") {
            throw new CellsError({
                code: CellsErrorCode.RunnerCrashed,
                params: { reason: "the runner answered a check to a run" },
            })
        }
        return result
    }

    async check(source: string): Promise<ReadonlyArray<string>> {
        const id = this.id()
        const limits = { ...this.options.limits, wallMs: CHECK_WALL_MS }
        const result = await this.withSlot((slot) =>
            this.converse(slot, { type: "check", id, source }, limits, new Set(), null),
        )
        if (result.type !== "checked") return [`runner: the check ended as ${result.type}`]
        return result.problems
    }

    private id(): string {
        this.nextId += 1
        return `r${String(this.nextId)}`
    }

    private async withSlot<T>(use: (slot: Slot) => Promise<T>): Promise<T> {
        if (this.closed)
            throw new CellsError({ code: CellsErrorCode.RunnerCrashed, params: { reason: "the client is closed" } })
        while (this.active >= Math.max(1, this.options.poolSize)) {
            await new Promise<void>((resolve) => this.waiters.push(resolve))
        }
        this.active += 1
        const slot = this.takeSpare() ?? this.start()
        slot.child.ref()
        try {
            return await use(slot)
        } finally {
            this.kill(slot)
            this.active -= 1
            this.waiters.shift()?.()
            this.refill()
        }
    }

    private takeSpare(): Slot | null {
        for (let slot = this.spares.shift(); slot !== undefined; slot = this.spares.shift()) {
            if (slot.alive) return slot
        }
        return null
    }

    private refill(): void {
        while (this.warm && !this.closed && this.active + this.spares.length < Math.max(1, this.options.poolSize)) {
            const spare = this.start()
            spare.child.unref()
            // the pipes of a child process are sockets
            ;(spare.child.stdout as Socket).unref()
            ;(spare.child.stderr as Socket).unref()
            this.spares.push(spare)
        }
    }

    private kill(slot: Slot): void {
        if (!slot.alive) return
        slot.alive = false
        slot.child.stdin.destroy()
        slot.child.kill("SIGKILL")
    }

    /** The one place a process is started: the empty environment, the permission flags, the read set. */
    private start(): Slot {
        const plan = spawnPlanOf(this.options)
        const child = (this.options.spawnProcess ?? spawn)(plan.command, plan.args, plan.spawnOptions)
        const slot: Slot = { child, alive: true }
        child.on("exit", () => {
            slot.alive = false
        })
        child.on("error", () => {
            slot.alive = false
        })
        child.stdin.on("error", () => undefined)
        child.stderr.on("data", () => undefined)
        return slot
    }

    private converse(
        slot: Slot,
        first: RunnerInbound,
        limits: RunnerLimits,
        declared: ReadonlySet<string>,
        door: RunnerDoor | null,
    ): Promise<Extract<RunnerOutbound, { type: "done" | "ended" | "failed" | "checked" }>> {
        const { child } = slot
        const id = first.id
        // a message is cut off when the bytes waiting for their newline pass this (counted in characters: a few times that many bytes at most)
        const maxLine = limits.outputBytes + MESSAGE_ROOM_BYTES
        return new Promise((resolve, reject) => {
            let settled = false
            let buffered = ""
            let expectedCall = 1
            let waitingOnDoor = false
            let spent = 0
            let since = performance.now()
            let timer: NodeJS.Timeout | null = null
            const stderrTail: string[] = []

            const finish = (action: () => void): void => {
                if (settled) return
                settled = true
                if (timer !== null) clearTimeout(timer)
                this.kill(slot)
                action()
            }
            const failed = (why: "limits" | "output", detail: string): void =>
                finish(() => resolve({ type: "failed", id, why, detail }))
            const crashed = (reason: string): void =>
                finish(() =>
                    reject(
                        new CellsError({
                            code: CellsErrorCode.RunnerCrashed,
                            params: { reason: clip(`${reason} ${stderrTail.join("")}`.trim()) },
                        }),
                    ),
                )
            const arm = (): void => {
                since = performance.now()
                timer = setTimeout(() => failed("limits", "wall clock"), Math.max(1, limits.wallMs - spent))
            }
            const disarm = (): void => {
                spent += performance.now() - since
                if (timer !== null) clearTimeout(timer)
                timer = null
            }

            const send = (message: RunnerInbound): void => {
                child.stdin.write(`${JSON.stringify(message)}\n`)
            }

            const serveDoor = (message: Extract<RunnerOutbound, { type: "call" | "say" }>): void => {
                if (door === null) return crashed("the child asked for a door that this request does not have")
                if (message.call !== expectedCall || expectedCall > limits.maxCalls) {
                    return message.call === expectedCall
                        ? failed("limits", "calls")
                        : crashed("the child broke the call order")
                }
                if (message.type === "call") {
                    if (
                        typeof message.tool !== "string" ||
                        message.tool.length === 0 ||
                        message.tool.length > MAX_TOOL_NAME_CHARS
                    ) {
                        return crashed("the child named a tool that is not a name")
                    }
                    if (!declared.has(message.tool)) {
                        return finish(() =>
                            reject(
                                new CellsError({ code: CellsErrorCode.ToolUndeclared, params: { tool: message.tool } }),
                            ),
                        )
                    }
                }
                expectedCall += 1
                waitingOnDoor = true
                disarm()
                const asked: Promise<JsonValue> =
                    message.type === "call"
                        ? door.call(message.call, message.tool, message.args)
                        : door.say(message.call, message.request)
                asked.then(
                    (answer) => {
                        if (settled) return
                        waitingOnDoor = false
                        arm()
                        send({ type: "answer", id, call: message.call, answer })
                    },
                    (error: unknown) => finish(() => reject(error)),
                )
            }

            const onMessage = (value: unknown): void => {
                if (!isRecord(value) || value.id !== id || typeof value.type !== "string")
                    return crashed("the child sent a message that is not ours")
                if (waitingOnDoor) return crashed("the child spoke while its call was waiting")
                const message = value as unknown as RunnerOutbound
                switch (message.type) {
                    case "call":
                    case "say":
                        return Number.isInteger(message.call)
                            ? serveDoor(message)
                            : crashed("the child numbered a call badly")
                    case "done":
                        return "output" in message
                            ? finish(() => resolve({ type: "done", id, output: message.output }))
                            : crashed("done without output")
                    case "ended":
                        return typeof message.why === "string" && message.reason === "cannot"
                            ? finish(() => resolve({ type: "ended", id, reason: "cannot", why: clip(message.why) }))
                            : crashed("ended badly")
                    case "failed":
                        return FAILURE_KINDS.includes(message.why) && typeof message.detail === "string"
                            ? finish(() =>
                                  resolve({ type: "failed", id, why: message.why, detail: clip(message.detail) }),
                              )
                            : crashed("failed badly")
                    case "checked":
                        return Array.isArray(message.problems) &&
                            message.problems.every((problem) => typeof problem === "string")
                            ? finish(() => resolve({ type: "checked", id, problems: message.problems.map(clip) }))
                            : crashed("checked badly")
                    default:
                        return crashed("the child sent an unknown message")
                }
            }

            const onLine = (line: string): void => {
                if (settled || line.length === 0) return
                let parsed: unknown
                try {
                    parsed = JSON.parse(line)
                } catch {
                    return crashed("the child sent a line that is not JSON")
                }
                onMessage(parsed)
            }

            child.stdout.setEncoding("utf8")
            child.stdout.on("data", (chunk: string) => {
                buffered += chunk
                for (let end = buffered.indexOf("\n"); end >= 0 && !settled; end = buffered.indexOf("\n")) {
                    const line = buffered.slice(0, end)
                    buffered = buffered.slice(end + 1)
                    onLine(line)
                }
                if (!settled && buffered.length > maxLine)
                    failed("output", "a message from the runner was longer than the limit")
            })
            child.stderr.setEncoding("utf8")
            child.stderr.on("data", (chunk: string) => {
                if (stderrTail.join("").length < MAX_DETAIL_CHARS) stderrTail.push(chunk)
            })
            child.on("error", (error) => crashed(`the runner did not start: ${error.message}`))
            child.on("close", (code, signal) =>
                crashed(`the runner ended (${String(code ?? signal)}) before it answered`),
            )

            arm()
            send(first)
        })
    }
}
