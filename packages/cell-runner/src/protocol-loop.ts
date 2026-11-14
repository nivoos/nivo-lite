import { checkGuest, runGuest, type GuestDoor } from "./guest-run"
import type { JsonValue, RunnerInbound, RunnerOutbound } from "./protocol"

/** The ends of the loop, so a spec can drive it without a process. */
export interface LoopPorts {
    /** Writes one outbound message (one JSON line). */
    readonly send: (message: RunnerOutbound) => void
    /** Ends the process after the one request this process serves. */
    readonly finish: () => void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** Reads the parent's messages line by line: one `run` or one `check` per process, `answer` lines in between. */
export const createLoop = (
    ports: LoopPorts,
): { readonly line: (text: string) => void; readonly closed: () => void } => {
    const waiting = new Map<string, (answer: JsonValue) => void>()
    let busy = false
    let activeId: string | null = null

    const door = (id: string): GuestDoor => {
        const ask = (message: RunnerOutbound, call: number): Promise<JsonValue> =>
            new Promise<JsonValue>((resolve) => {
                waiting.set(`${id}:${String(call)}`, resolve)
                ports.send(message)
            })
        return {
            call: (call, tool, args) => ask({ type: "call", id, call, tool, args }, call),
            say: (call, request) => ask({ type: "say", id, call, request }, call),
        }
    }

    const handle = (message: RunnerInbound): void => {
        if (message.type === "answer") {
            const key = `${message.id}:${String(message.call)}`
            const resolve = waiting.get(key)
            if (resolve !== undefined) {
                waiting.delete(key)
                resolve(message.answer)
            }
            return
        }
        if (busy) return
        busy = true
        activeId = message.id
        const work =
            message.type === "run"
                ? runGuest(message, door(message.id)).then((result) => ports.send(result))
                : checkGuest(message.source).then((problems) =>
                      ports.send({ type: "checked", id: message.id, problems }),
                  )
        work.catch((error: unknown) => {
            ports.send({
                type: "failed",
                id: message.id,
                why: "thrown",
                detail: error instanceof Error ? error.message.slice(0, 300) : "unknown",
            })
        }).finally(ports.finish)
    }

    return {
        line: (text) => {
            if (text.trim().length === 0) return
            let parsed: unknown
            try {
                parsed = JSON.parse(text)
            } catch {
                return
            }
            if (!isRecord(parsed) || typeof parsed.type !== "string" || typeof parsed.id !== "string") return
            handle(parsed as unknown as RunnerInbound)
        },
        // the parent went away: nothing can answer a pending call any more
        closed: () => {
            if (activeId === null || waiting.size > 0) ports.finish()
        },
    }
}
