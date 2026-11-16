import type { SandboxCallsQuery } from "@/modules/api"
import type { SandboxScopeChoiceView, SandboxScopeView } from "@/modules/types"
import type { SandboxWords } from "./sandbox.words"

/** The provider whose calls are logged under a purpose and whose next case may be picked for one purpose only (the model account). */
export const SANDBOX_SCOPE_PROVIDER = "model"

/** The id of the choice "every call"; a purpose never takes it (a purpose is `<id>:<tag>`). */
export const SANDBOX_SCOPE_ALL = "*"

/** The purpose a call with no narrower purpose is logged under: it is the every-call pick, never a purpose of its own. */
const EVERY_CALL = "call"

/** The tag a graph node's own agent turn is logged under (`<node id>:agent`). */
const AGENT_TAG = "agent"

/** One call of the log as the back end answers it. */
type CallWire = SandboxCallsQuery["sandboxCalls"][number]

/** The words of a purpose: what it is in plain words, and the key under which the call log holds it when the words are generic (so two generic ones stay apart). */
export interface PurposeText {
    readonly label: string
    readonly hint: string | null
}

/** The tag after the first `:` of a purpose; empty when there is none. */
const tagOf = (purpose: string): string => {
    const at = purpose.indexOf(":")
    return at < 0 ? "" : purpose.slice(at + 1)
}

/**
 * The words of one purpose: its own words when the app declares them (the facts steps, the AI core), else the generic word for a graph
 * node's agent turn or for any other call, with the key as the hint. The API names no node label on this page, so the key is never the
 * only text.
 */
export const purposeTextOf = (purpose: string, words: SandboxWords): PurposeText => {
    const known = words.purposeKnown(purpose)
    if (known !== null) return { label: known, hint: null }
    return { label: tagOf(purpose) === AGENT_TAG ? words.purposeNode : words.purposeOther, hint: purpose }
}

/** The purposes the log holds, newest first, each once; the every-call key is no purpose. */
const purposesOfCalls = (calls: ReadonlyArray<CallWire>): ReadonlyArray<string> => {
    const seen = new Set<string>()
    const purposes: Array<string> = []
    for (const call of [...calls].reverse()) {
        if (call.key === EVERY_CALL || call.key === "" || seen.has(call.key)) continue
        seen.add(call.key)
        purposes.push(call.key)
    }
    return purposes
}

/**
 * The widths a next case may be picked for on the model account: every call, or one purpose seen in the call log. Null for any other
 * provider and while the log is not read. The pick stays on the width the person chose while it is still in the log, else every call.
 */
export const scopeOf = (
    provider: string,
    calls: ReadonlyArray<CallWire> | undefined,
    chosen: string | null,
    words: SandboxWords,
): SandboxScopeView | null => {
    if (provider !== SANDBOX_SCOPE_PROVIDER || calls === undefined) return null
    const purposes = purposesOfCalls(calls)
    const choices: ReadonlyArray<SandboxScopeChoiceView> = [
        { id: SANDBOX_SCOPE_ALL, label: words.scopeAll, hint: words.scopeAllHint },
        ...purposes.map((purpose) => {
            const text = purposeTextOf(purpose, words)
            return { id: purpose, label: text.label, hint: text.hint }
        }),
    ]
    const selectedId = chosen !== null && purposes.includes(chosen) ? chosen : SANDBOX_SCOPE_ALL
    return { choices, selectedId }
}
