import { TOOL } from "@nivo-lite/agent-sdk/names"
import type { NodeContext } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { MAX_ID } from "../bounds"
import { valueOrCannot } from "../nodes/tool-answers"
import { MESSAGE_READ_LIMIT, THREAD_LINES_MAX } from "./front-desk.policy"

/**
 * The ONE reader of a conversation's thread (NODES-LEAD consolidation 2026-11-12): the Chatbot steps and the Sales consult read the
 * thread through `nivo.tool.conversation.message.list` here, and nowhere else. A thread row is `{ role, text, at, files? }`
 * (ASSUMPTIONS-A T1 as amended: `files` is the pictures and files of the line, absent when it has none).
 */

const LINE_MAX = 300
const URL_MAX = 2000

/** A file of a thread line, as the conversation read answers it; a file the shop could not keep has no address. */
export interface ThreadFile {
    /** The address the model host can fetch, or null when the file was not kept. */
    readonly url: string | null
    /** Its type (`image/jpeg`). */
    readonly contentType: string
}

/** A line of the conversation, as `nivo.tool.conversation.message.list` answers it. */
export interface ThreadFact {
    /** Who wrote it: the customer (`user`), the shop (`agent`) or the system. */
    readonly role: string
    /** What was written. */
    readonly text: string
    /** When it was written, ISO; lines are ordered by it. */
    readonly at: string
    /** The pictures and files sent with the line, or absent when none. */
    readonly files?: ReadonlyArray<ThreadFile> | undefined
    /** The line's position in the conversation's stream (decimal text), as the engine's read answers it; absent from an older engine. */
    readonly seq?: string | undefined
    /**
     * Whether a run already CONSUMED this line (the engine's stream cursor, rule QB-P5 C-4: a step read it and ended), set by `threadRowsOf`
     * on the person's lines when the read names a cursor; absent when it names none (no run consumed the conversation yet).
     */
    readonly consumed?: boolean | undefined
}

/** The members of a conversation read's answer a step reads: the lines, newest first. */
const threadAnswer = z.object({
    /** The engine's stream cursor of the conversation (decimal text), or null / absent while no run consumed it. */
    consumedSeq: z.string().max(MAX_ID).nullable().optional(),
    facts: z.array(
        z.looseObject({
            seq: z.string().max(MAX_ID).optional(),
            role: z.string().max(MAX_ID),
            text: z.string(),
            at: z.string().max(MAX_ID),
            files: z
                .array(z.object({ url: z.string().max(URL_MAX).nullable(), contentType: z.string().max(MAX_ID) }))
                .optional(),
        }),
    ),
})

/** The members of a lead order read's answer the front desk reads (ASSUMPTIONS-A, T2): the orders, newest first, by their code. */
const ordersAnswer = z.object({ facts: z.array(z.looseObject({ orderNo: z.string().max(MAX_ID).nullable() })) })

/**
 * The last lines of a conversation, oldest first, each tagged with who said it; system lines and empty lines are left out. A format
 * step only: the role is a field of the record, compared exactly, never a word of the text.
 */
export const threadLinesOf = (facts: ReadonlyArray<ThreadFact>): ReadonlyArray<string> =>
    facts
        .filter((fact) => (fact.role === "user" || fact.role === "agent") && fact.text.trim() !== "")
        .toSorted((left, right) => left.at.localeCompare(right.at))
        .slice(-THREAD_LINES_MAX)
        .map((fact) => `${fact.role === "user" ? "customer" : "shop"}: ${fact.text.trim().slice(0, LINE_MAX)}`)

/** True when the decimal text `left` is a greater stream position than `right` (non-negative integers). */
const seqAfter = (left: string, right: string): boolean => {
    const [a, b] = [left.replace(/^0+(?=\d)/u, ""), right.replace(/^0+(?=\d)/u, "")]
    return a.length === b.length ? a > b : a.length > b.length
}

/**
 * The person's lines marked against the engine's stream cursor (rule QB-P5 C-4): each line with a position is `consumed` when it is at or
 * before the cursor. Unchanged when the read names no cursor (no run consumed the conversation yet) or a line has no position.
 */
export const withCursorOf = (facts: ReadonlyArray<ThreadFact>, consumedSeq: string | null | undefined): ReadonlyArray<ThreadFact> =>
    consumedSeq === null || consumedSeq === undefined
        ? facts
        : facts.map((fact) =>
              fact.role !== "user" || fact.seq === undefined ? fact : { ...fact, consumed: !seqAfter(fact.seq, consumedSeq) },
          )

/** True for a line of the person with words or files. */
const isSaid = (fact: ThreadFact): boolean => fact.role === "user" && (fact.text.trim() !== "" || (fact.files ?? []).length > 0)

/**
 * What the person said that no run consumed yet, oldest first, each with its words and its files (a line with only a picture included).
 * With the engine's stream cursor (the read names one: `threadRowsOf` marks each line `consumed`): the person's lines AFTER the cursor,
 * whatever the shop said between them (a line a run read and handled without replying is never unread again, owner defect O-R6-2). With no
 * cursor (no run consumed the conversation yet, or an older engine): the person's lines after the shop's last line. This, not the one
 * event that woke the step, is what a step that judges or answers the person reads: several lines may have arrived (a burst, lines held
 * while the run was busy) and the engine wakes the step ONCE for them (R73, a `stream` marker). A format step only: the role and the
 * position are fields of the record, compared exactly, never a word of the text.
 */
export const unreadLinesOf = (facts: ReadonlyArray<ThreadFact>): ReadonlyArray<ThreadFact> => {
    const ordered = facts.toSorted((left, right) => left.at.localeCompare(right.at))
    if (ordered.some((fact) => fact.consumed !== undefined)) return ordered.filter((fact) => isSaid(fact) && fact.consumed === false)
    const lastShop = ordered.map((fact) => fact.role).lastIndexOf("agent")
    return ordered.slice(lastShop + 1).filter((fact) => isSaid(fact))
}

/** The words of the unread lines (`unreadLinesOf`), one line each, oldest first; empty when they carry none (pictures only, or nothing unread). */
export const unreadTextOf = (facts: ReadonlyArray<ThreadFact>): string =>
    unreadLinesOf(facts)
        .map((fact) => fact.text.trim())
        .filter((text) => text !== "")
        .join(String.fromCharCode(10))

/**
 * The pictures of the unread lines, oldest first, at most `max` (the newest kept), by the address the model host fetches. A picture the
 * shop could not keep (no address) is handed as an empty address, so the host tells the model it came unseen instead of showing it. The
 * content type is a field of the row, compared by its registered prefix (a format check, not meaning).
 */
export const unreadPicturesOf = (facts: ReadonlyArray<ThreadFact>, max: number): ReadonlyArray<string> =>
    unreadLinesOf(facts)
        .flatMap((fact) => (fact.files ?? []).filter((file) => file.contentType.startsWith("image/")).map((file) => file.url ?? ""))
        .slice(-max)

/** How much of the conversation a read takes: at most `limit` lines, and only those said from `since` on (ISO; null: the whole route). */
export interface ThreadWindow {
    /** The most lines. */
    readonly limit?: number | undefined
    /** The chatbot's chat window (`startedAt`): after a Telegram `/start` the model is never handed the earlier visit. */
    readonly since?: string | null | undefined
    /**
     * True for a read of what the person said that the step takes as its own to handle (`unreadLinesOf` and its kin): the engine counts the
     * lines it hands out as consumed once the step ends (its stream cursor, rule QB-P5 C-4). Absent: a read for context, which consumes nothing.
     */
    readonly consume?: boolean | undefined
}

/**
 * The rows of the conversation the run serves, as the engine's read answers them (newest first, both directions, every agent's). The
 * read takes no conversation id (the engine locks it to the run's own route). A refusal means the run serves no conversation: the step
 * cannot work, and says so.
 */
export const threadRowsOf = async (context: NodeContext, window: ThreadWindow = {}): Promise<ReadonlyArray<ThreadFact>> => {
    const since = window.since ?? null
    const read = valueOrCannot(
        context,
        TOOL.conversationMessageList,
        await context.tools.call(TOOL.conversationMessageList, {
            limit: window.limit ?? MESSAGE_READ_LIMIT,
            ...(since === null ? {} : { since }),
            ...(window.consume === true ? { consume: true } : {}),
        }),
    )
    const answer = threadAnswer.parse(read)
    return withCursorOf(answer.facts, answer.consumedSeq)
}

/** The recent thread of the conversation the run serves, as the lines the model is shown. */
export const threadOf = async (context: NodeContext, window: ThreadWindow = {}): Promise<ReadonlyArray<string>> =>
    threadLinesOf(await threadRowsOf(context, window))

/**
 * The code of the last order of the customer the run serves, or null when the customer has none or the run serves no known customer
 * (the read refuses). It replaces today's `lead.lastOrderCode` ref (lead memory), which the contract's `ref` cannot name. A hint for
 * the model only: no branch of code depends on it.
 */
export const lastOrderCodeOf = async (context: NodeContext): Promise<string | null> => {
    const read = await context.tools.call(TOOL.leadOrderList, { limit: 1 })
    if (!read.ok) return null
    return ordersAnswer.parse(read.value).facts[0]?.orderNo ?? null
}

/** The most recent lines a front-door step hands on to the workflow it calls. */
export const RECENT_LINES_MAX: number = MESSAGE_READ_LIMIT

/** One recent line as a hand-off carries it (`recentLines`): who wrote it, the words, when, and its pictures and files. */
export const threadFactSchema: z.ZodType<ThreadFact, ThreadFact> = z.object({
    role: z.string().max(MAX_ID),
    text: z.string().max(LINE_MAX * 30),
    at: z.string().max(MAX_ID),
    files: z
        .array(z.object({ url: z.string().max(URL_MAX).nullable(), contentType: z.string().max(MAX_ID) }))
        .max(RECENT_LINES_MAX)
        .optional(),
})

/** The recent lines a hand-off carries: at most `RECENT_LINES_MAX`, each of them `threadFactSchema`. */
export const recentLinesSchema: z.ZodType<ReadonlyArray<ThreadFact>, ReadonlyArray<ThreadFact>> = z.array(threadFactSchema).max(RECENT_LINES_MAX)

/**
 * The recent lines of the conversation a front door hands on (`recentLines`): the customer's and the shop's, oldest first, a line with
 * words or with pictures, at most `RECENT_LINES_MAX`. The callee reads them instead of the conversation (the conversation read is the
 * owning agent's). A format step only: the role is a field of the record, compared exactly.
 */
export const recentLinesOf = (facts: ReadonlyArray<ThreadFact>): ReadonlyArray<ThreadFact> =>
    facts
        .filter((fact) => (fact.role === "user" || fact.role === "agent") && (fact.text.trim() !== "" || (fact.files ?? []).length > 0))
        .toSorted((left, right) => left.at.localeCompare(right.at))
        .slice(-RECENT_LINES_MAX)
        .map((fact) => ({
            role: fact.role,
            text: fact.text,
            at: fact.at,
            ...(fact.files === undefined ? {} : { files: fact.files.map((file) => ({ url: file.url, contentType: file.contentType })) }),
        }))
