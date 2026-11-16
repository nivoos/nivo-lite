import type { NodeContext } from "@nivo-lite/agent-sdk/template"
import { threadRowsOf, unreadLinesOf, unreadPicturesOf, unreadTextOf, withCursorOf, type ThreadFact } from "./front-desk.reads"

// THE STREAM CURSOR, the reader's half (rule QB-P5 C-4, owner defect O-R6-2): the engine's read names the position runs consumed
// (`consumedSeq`) and each line's own (`seq`); "what the person said" is the person's lines AFTER the cursor. With no cursor (no run
// consumed the conversation yet, or an engine that names none) the reader keeps the old rule: after the shop's last line.

const line = (seq: string, role: "user" | "agent", text: string, at: string, files?: ThreadFact["files"]): ThreadFact => ({
    seq,
    role,
    text,
    at: `2026-11-14T10:00:${at}.000Z`,
    ...(files === undefined ? {} : { files }),
})

/** O-R6-2: an old line a run read and handled WITHOUT a reply (seq 5), then the shop answered something else, then two new lines. */
const thread: ReadonlyArray<ThreadFact> = [
    line("4", "agent", "Chao chi", "00"),
    line("5", "user", "Huy don DH-1 nhe", "05"),
    line("6", "user", "Co hoa huong duong khong?", "10"),
    line("7", "agent", "Da co a", "15"),
    line("8", "user", "Toi nay giao duoc khong", "20"),
    line("9", "user", "", "21", [{ url: "https://x/p.jpg", contentType: "image/jpeg" }]),
]

/** A step context whose one tool answers the conversation read as the engine does. */
const contextAnswering = (answer: Readonly<Record<string, unknown>>): NodeContext =>
    ({ tools: { call: () => Promise.resolve({ ok: true, value: answer }) } }) as unknown as NodeContext

describe("unread lines after the engine's stream cursor", () => {
    it("with a cursor: the person's lines after it, whatever the shop said between; a consumed line is never unread again", () => {
        const marked = withCursorOf(thread, "6")
        expect(unreadLinesOf(marked).map((fact) => fact.seq)).toEqual(["8", "9"])
        expect(unreadTextOf(marked)).toBe("Toi nay giao duoc khong")
        expect(unreadPicturesOf(marked, 4)).toEqual(["https://x/p.jpg"])
    })

    it("a line consumed by a run that did NOT reply (seq 5) stays read although the shop's last line is later than it", () => {
        // The old rule ("after the shop's last line") would answer 8 and 9 too here; the cursor at 5 keeps 6 unread: no run consumed it.
        expect(unreadLinesOf(withCursorOf(thread, "5")).map((fact) => fact.seq)).toEqual(["6", "8", "9"])
    })

    it("a cursor at the newest line: nothing unread (the reader falls back to the line that woke it)", () => {
        expect(unreadLinesOf(withCursorOf(thread, "9"))).toEqual([])
        expect(unreadTextOf(withCursorOf(thread, "12"))).toBe("")
    })

    it("positions compare as numbers, not as text (10 is after 9)", () => {
        const long = [line("9", "user", "nine", "01"), line("10", "user", "ten", "02")]
        expect(unreadLinesOf(withCursorOf(long, "9")).map((fact) => fact.text)).toEqual(["ten"])
    })

    it("with NO cursor (none yet, or an engine that names none): the person's lines after the shop's last line, as before", () => {
        expect(unreadLinesOf(withCursorOf(thread, null)).map((fact) => fact.seq)).toEqual(["8", "9"])
        expect(unreadLinesOf(thread.map(({ seq: _seq, ...rest }) => rest)).map((fact) => fact.text)).toEqual(["Toi nay giao duoc khong", ""])
    })

    it("threadRowsOf marks the lines with the cursor the engine's read names; no cursor marks nothing", async () => {
        const facts = [...thread].reverse()
        const marked = await threadRowsOf(contextAnswering({ consumedSeq: "6", facts }))
        expect(unreadLinesOf(marked).map((fact) => fact.seq)).toEqual(["8", "9"])
        expect(marked.filter((fact) => fact.consumed === true).map((fact) => fact.seq)).toEqual(["6", "5"])
        const plain = await threadRowsOf(contextAnswering({ consumedSeq: null, facts }))
        expect(plain.some((fact) => fact.consumed !== undefined)).toBe(false)
        const older = await threadRowsOf(contextAnswering({ facts }))
        expect(unreadLinesOf(older).map((fact) => fact.seq)).toEqual(["8", "9"])
    })
})
