import { newQuickJSAsyncWASMModule, RELEASE_ASYNC } from "quickjs-emscripten"
import type {
    QuickJSAsyncContext,
    QuickJSAsyncRuntime,
    QuickJSAsyncWASMModule,
    QuickJSHandle,
} from "quickjs-emscripten"
import { PRELUDE } from "./prelude"
import type { JsonValue, RunnerInbound, RunnerRunResult } from "./protocol"

/** What the guest may reach: the two ways out. The loop of the process answers them through the parent. */
export interface GuestDoor {
    call(call: number, tool: string, args: JsonValue): Promise<JsonValue>
    say(call: number, request: JsonValue): Promise<JsonValue>
}

type RunRequest = Extract<RunnerInbound, { readonly type: "run" }>

/**
 * The WebAssembly stack of the host engine is the limit that really binds: past about 256 KB of QuickJS stack the engine's own stack ends first and
 * throws a RangeError that no guest code can catch. The stack limit a run asks for is clamped to this value (CELLS-PLAN 4.4 asked for 1 MB).
 */
export const STACK_CEILING_BYTES = 256 * 1024

const DETAIL_CHARS = 300

let loaded: Promise<QuickJSAsyncWASMModule> | null = null

/** The WebAssembly module (asyncify, release build), loaded once per process. */
export const quickJs = (): Promise<QuickJSAsyncWASMModule> => {
    loaded ??= newQuickJSAsyncWASMModule(RELEASE_ASYNC)
    return loaded
}

const clip = (text: string): string => (text.length > DETAIL_CHARS ? `${text.slice(0, DETAIL_CHARS)}...` : text)

interface GuestError {
    readonly name: string
    readonly message: string
}

const readError = (context: QuickJSAsyncContext, handle: QuickJSHandle): GuestError => {
    const dumped: unknown = context.dump(handle)
    handle.dispose()
    if (typeof dumped === "object" && dumped !== null) {
        const record = dumped as { readonly name?: unknown; readonly message?: unknown }
        return {
            name: typeof record.name === "string" ? record.name : "Error",
            message: typeof record.message === "string" ? record.message : "",
        }
    }
    return { name: "Error", message: typeof dumped === "string" ? dumped : "" }
}

/** Runs one source in a fresh QuickJS runtime under the limits and answers the terminal message; never throws. */
export const runGuest = async (request: RunRequest, door: GuestDoor): Promise<RunnerRunResult> => {
    const { id, limits } = request
    let runtime: QuickJSAsyncRuntime | null = null
    let context: QuickJSAsyncContext | null = null
    try {
        const module = await quickJs()
        runtime = module.newRuntime({
            memoryLimitBytes: limits.memoryBytes,
            maxStackSizeBytes: Math.min(limits.stackBytes, STACK_CEILING_BYTES),
        })
        context = runtime.newContext()
        return await execute(request, door, runtime, context)
    } catch (error) {
        const name = error instanceof Error ? error.name : "Error"
        const message = error instanceof Error ? error.message : String(error)
        return {
            type: "failed",
            id,
            why: name === "RangeError" ? "limits" : "thrown",
            detail: clip(`${name}: ${message}`),
        }
    } finally {
        try {
            context?.dispose()
            runtime?.dispose()
        } catch {
            // a runtime that stopped in the middle of a suspended call may refuse to dispose; the process ends after the run anyway
        }
    }
}

const execute = async (
    request: RunRequest,
    door: GuestDoor,
    runtime: QuickJSAsyncRuntime,
    context: QuickJSAsyncContext,
): Promise<RunnerRunResult> => {
    const { id, limits, entry } = request
    let limitHit: string | null = null
    let calls = 0
    let sliceStart = performance.now()
    let cpuUsed = 0
    const pause = (): void => {
        cpuUsed += performance.now() - sliceStart
    }
    const resume = (): void => {
        sliceStart = performance.now()
    }
    runtime.setInterruptHandler(() => {
        if (limitHit !== null) return true
        if (cpuUsed + (performance.now() - sliceStart) > limits.cpuMs) {
            limitHit = "cpu time"
            return true
        }
        return false
    })

    const wayOut = (
        name: string,
        serve: (call: number, texts: ReadonlyArray<string>) => Promise<JsonValue>,
    ): QuickJSHandle =>
        context.newAsyncifiedFunction(name, async (...handles) => {
            const texts = handles.map((handle) =>
                context.typeof(handle) === "string" ? context.getString(handle) : "",
            )
            if (!request.capabilities.includes("tool")) throw new Error("this run has no way out")
            pause()
            try {
                calls += 1
                if (calls > limits.maxCalls) {
                    limitHit = "calls"
                    throw new Error("the call limit is reached")
                }
                return context.newString(JSON.stringify(await serve(calls, texts)))
            } finally {
                resume()
            }
        })
    const toolHost = wayOut("__host_call", (call, [tool = "", text = "null"]) =>
        door.call(call, tool, JSON.parse(text) as JsonValue),
    )
    const sayHost = wayOut("__host_say", (call, [text = "null"]) => door.say(call, JSON.parse(text) as JsonValue))
    context.setProp(context.global, "__host_call", toolHost)
    context.setProp(context.global, "__host_say", sayHost)
    toolHost.dispose()
    sayHost.dispose()

    const config = JSON.stringify({
        facts: request.facts,
        input: request.input,
        outputBytes: limits.outputBytes,
        capabilities: request.capabilities,
    })
    const steps = [
        PRELUDE,
        `__cell_install(${JSON.stringify(config)}); delete globalThis.__cell_install;`,
        request.source,
        `__cell_invoke(${JSON.stringify(entry)})`,
    ]
    let last: QuickJSHandle | null = null
    for (const [index, step] of steps.entries()) {
        resume()
        const result = await context.evalCodeAsync(step, index === 2 ? "cell.js" : "prelude.js", { type: "global" })
        pause()
        last?.dispose()
        if (result.error !== undefined) {
            const error = readError(context, result.error)
            return failureOf(id, error, limitHit, index === 2)
        }
        last = result.value
    }
    if (limitHit !== null) return { type: "failed", id, why: "limits", detail: limitHit }
    if (last === null) return { type: "failed", id, why: "thrown", detail: "the source answered nothing" }
    const answer = context.typeof(last) === "string" ? context.getString(last) : ""
    last.dispose()
    return answerOf(id, answer, limits.outputBytes)
}

const failureOf = (id: string, error: GuestError, limitHit: string | null, compiling: boolean): RunnerRunResult => {
    if (limitHit !== null) return { type: "failed", id, why: "limits", detail: limitHit }
    if (error.name === "InternalError") return { type: "failed", id, why: "limits", detail: clip(error.message) }
    if (compiling && error.name === "SyntaxError")
        return { type: "failed", id, why: "syntax", detail: clip(error.message) }
    return { type: "failed", id, why: "thrown", detail: clip(`${error.name}: ${error.message}`) }
}

const answerOf = (id: string, answer: string, outputBytes: number): RunnerRunResult => {
    const tag = answer.slice(0, 1)
    const rest = answer.slice(1)
    if (tag === "E") return { type: "ended", id, reason: "cannot", why: clip(rest) }
    if (tag === "D") {
        if (Buffer.byteLength(rest, "utf8") > outputBytes)
            return { type: "failed", id, why: "output", detail: "the output is longer than the limit" }
        try {
            return { type: "done", id, output: JSON.parse(rest) as JsonValue }
        } catch {
            return { type: "failed", id, why: "output", detail: "the output is not JSON" }
        }
    }
    if (tag === "F") return { type: "failed", id, why: "output", detail: clip(rest) }
    return { type: "failed", id, why: "output", detail: "the source answered nothing the runner knows" }
}

/** Parses a source without running it. Answers the problems (empty: a valid script); module syntax is its own problem, tagged `imports`. */
export const checkGuest = async (source: string): Promise<ReadonlyArray<string>> => {
    const module = await quickJs()
    const runtime = module.newRuntime({ memoryLimitBytes: 64 * 1024 * 1024, maxStackSizeBytes: STACK_CEILING_BYTES })
    const context = runtime.newContext()
    try {
        const asScript = context.evalCode(source, "cell.js", { type: "global", compileOnly: true })
        if (asScript.error === undefined) {
            asScript.value.dispose()
            return []
        }
        const scriptError = readError(context, asScript.error)
        const asModule = context.evalCode(source, "cell.js", { type: "module", compileOnly: true })
        if (asModule.error === undefined) {
            asModule.value.dispose()
            return ["imports: module syntax (import, export or top-level await) is not allowed; a source is a script"]
        }
        // an `import` of a name the engine cannot load fails as a ReferenceError after the module parsed: still module syntax
        const moduleError = readError(context, asModule.error)
        if (moduleError.name !== "SyntaxError")
            return ["imports: module syntax (import, export or top-level await) is not allowed; a source is a script"]
        return [`syntax: ${clip(scriptError.message)}`]
    } finally {
        context.dispose()
        runtime.dispose()
    }
}
