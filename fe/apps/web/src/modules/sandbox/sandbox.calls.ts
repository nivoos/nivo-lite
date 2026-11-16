import type { SandboxCallsQuery } from "@/modules/api"
import type { SandboxCallRowView, SandboxCallsData } from "@/modules/types"
import { purposeTextOf, SANDBOX_SCOPE_PROVIDER } from "./sandbox.purposes"
import { SANDBOX_JOIN, type SandboxWords } from "./sandbox.words"

/** How many lines of the call log a page draws, and how many more a press adds. */
export const CALLS_PAGE = 10

/** The case a logged request names (a send carries its case id in the request), else nothing. */
const caseIdOf = (requestJson: string): string | null => {
    try {
        const parsed: unknown = JSON.parse(requestJson)
        if (typeof parsed === "object" && parsed !== null && "caseId" in parsed && typeof parsed.caseId === "string") {
            return parsed.caseId
        }
    } catch {
        return null
    }
    return null
}

/** What a call was about: the case a send names; on the model account the purpose in words (its key only as a hint); else the key. */
const whatOf = (call: SandboxCallsQuery["sandboxCalls"][number], provider: string, words: SandboxWords): ReadonlyArray<string> => {
    const caseId = caseIdOf(call.requestJson)
    if (caseId !== null) return [caseId]
    if (provider !== SANDBOX_SCOPE_PROVIDER) return [call.key]
    const text = purposeTextOf(call.key, words)
    return text.hint === null ? [text.label] : [text.label, text.hint]
}

/** One line of the call log: what was called, which case or purpose, when and, when it threw, why. */
const callRowOf = (
    call: SandboxCallsQuery["sandboxCalls"][number],
    provider: string,
    words: SandboxWords,
): SandboxCallRowView => {
    const isFailed = call.outcome === "threw"
    return {
        id: call.id,
        title: call.operation === "inbound" ? words.inbound : call.operation,
        line: [...whatOf(call, provider, words), words.time(call.at), isFailed ? (call.error ?? "") : ""]
            .filter((part) => part !== "")
            .join(SANDBOX_JOIN),
        isFailed,
    }
}

/** The call log, newest first, cut to what is drawn (the back end answers oldest first, at most 500). */
export const callsDataOf = (
    calls: SandboxCallsQuery["sandboxCalls"],
    shown: number,
    provider: string,
    words: SandboxWords,
): SandboxCallsData => {
    const newest = [...calls].reverse()
    return { rows: newest.slice(0, shown).map((call) => callRowOf(call, provider, words)), hasMore: newest.length > shown }
}
