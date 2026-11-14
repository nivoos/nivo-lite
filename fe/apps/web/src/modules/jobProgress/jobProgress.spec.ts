import { isJobProgressFrame, jobStateOf, NO_JOB_PROGRESS, selectorOf, viewOfFrames, withRootFrame, type JobFramesByRoot, type JobProgressFrame, type JobProgressWords } from "./index"
import { JOB_PROGRESS_ROOTS_MAX, withFrame, type JobFrames } from "./jobProgress.state"

const frame = (over: Partial<JobProgressFrame> & Pick<JobProgressFrame, "jobId" | "state" | "at">): JobProgressFrame => ({
    id: `${over.jobId}:${over.state}:${over.at}`,
    root: "knowledge-source:s1",
    job: "knowledge.index",
    ...over,
})

/** Words that echo the key, so a test sees which key was asked and with what. */
const words: JobProgressWords = {
    say: (key, values) => (values === undefined ? key : `${key}(${JSON.stringify(values)})`),
    clock: (iso) => `at:${iso}`,
}

const framesOf = (...list: ReadonlyArray<JobProgressFrame>): JobFrames => list.reduce<JobFrames>(withFrame, {})

describe("withFrame", () => {
    it("keeps the newest frame of a job and ignores an older one", () => {
        const newer = frame({ jobId: "a", state: "running", at: "2026-11-14T10:00:05Z", done: 2, total: 5 })
        const older = frame({ jobId: "a", state: "running", at: "2026-11-14T10:00:01Z", done: 1, total: 5 })
        expect(framesOf(newer, older).a).toBe(newer)
        expect(framesOf(older, newer).a).toBe(newer)
    })

    it("lets a later state of the same job replace the dead letter (a resumed job)", () => {
        const parked = frame({ jobId: "a", state: "dead_letter", at: "2026-11-14T10:00:00Z", failureClass: "input" })
        const resumed = frame({ jobId: "a", state: "running", at: "2026-11-14T10:05:00Z" })
        expect(viewOfFrames(framesOf(parked, resumed)).state).toBe("running")
    })
})

describe("viewOfFrames", () => {
    it("says none while nothing was heard", () => {
        expect(viewOfFrames(undefined)).toBe(NO_JOB_PROGRESS)
        expect(viewOfFrames({})).toBe(NO_JOB_PROGRESS)
    })

    it("ranks a dead letter over a retry over a running job over a done one", () => {
        const done = frame({ jobId: "d", state: "done", at: "2026-11-14T10:09:00Z" })
        const running = frame({ jobId: "r", state: "running", at: "2026-11-14T10:01:00Z", labelKey: "knowledge.facts.extract" })
        const retry = frame({ jobId: "t", state: "retry", at: "2026-11-14T10:02:00Z", retryAt: "2026-11-14T10:12:00Z", attempt: 2 })
        const parked = frame({ jobId: "p", state: "dead_letter", at: "2026-11-14T10:00:00Z", failureClass: "config" })
        expect(viewOfFrames(framesOf(done, running)).state).toBe("running")
        expect(viewOfFrames(framesOf(done, running, retry))).toMatchObject({ state: "retry", attempt: 2, retryAt: "2026-11-14T10:12:00Z" })
        expect(viewOfFrames(framesOf(done, running, retry, parked))).toMatchObject({ state: "dead_letter", failureClass: "config", retryAt: null })
    })

    it("takes the newest of two jobs in the same state", () => {
        const first = frame({ jobId: "a", state: "running", at: "2026-11-14T10:00:00Z", labelKey: "knowledge.index.read" })
        const second = frame({ jobId: "b", state: "running", at: "2026-11-14T10:00:09Z", labelKey: "knowledge.index.embed" })
        expect(viewOfFrames(framesOf(first, second)).labelKey).toBe("knowledge.index.embed")
    })
})

describe("jobStateOf", () => {
    const at = "2026-11-14T10:00:00Z"

    it("words a running step with its count and a dot (the work is live)", () => {
        const view = viewOfFrames(framesOf(frame({ jobId: "a", state: "running", at, labelKey: "knowledge.index.read", done: 3, total: 12 })))
        const state = jobStateOf(view, words)
        expect(state?.label).toBe("step_knowledge_index_read 3/12")
        expect(state).toMatchObject({ tone: "warning", isDot: true, detail: null })
    })

    it("words a step without a count by the step alone", () => {
        const view = viewOfFrames(framesOf(frame({ jobId: "a", state: "running", at, labelKey: "knowledge.facts.extract" })))
        expect(jobStateOf(view, words)?.label).toBe("step_knowledge_facts_extract")
    })

    it("never shows a label key it does not know: the generic state word stands", () => {
        const view = viewOfFrames(framesOf(frame({ jobId: "a", state: "running", at, labelKey: "somebody.new.step", done: 1, total: 2 })))
        expect(jobStateOf(view, words)).toMatchObject({ label: "running", isDot: true })
        expect(JSON.stringify(jobStateOf(view, words))).not.toContain("somebody")
    })

    it("words a retry with its time, a dot, neutral", () => {
        const view = viewOfFrames(framesOf(frame({ jobId: "a", state: "retry", at, retryAt: "2026-11-14T14:32:00Z" })))
        const state = jobStateOf(view, words)
        expect(state?.label).toBe('retryAt({"time":"at:2026-11-14T14:32:00Z"})')
        expect(state).toMatchObject({ tone: "neutral", isDot: true, detail: null })
    })

    it("words a retry whose time is not known by the plain retry word", () => {
        const view = viewOfFrames(framesOf(frame({ jobId: "a", state: "retry", at })))
        expect(jobStateOf(view, words)?.label).toBe("retry")
    })

    it("words a dead letter as a neutral result with no dot and the class plainly", () => {
        for (const [failureClass, key] of [["input", "class_input"], ["config", "class_config"], ["transient", "class_transient"], ["code", "class_code"]] as const) {
            const view = viewOfFrames(framesOf(frame({ jobId: "a", state: "dead_letter", at, failureClass })))
            const state = jobStateOf(view, words)
            expect(state?.label).toBe("deadLetter")
            expect(state).toMatchObject({ tone: "neutral", isDot: false, detail: key })
        }
    })

    it("words a dead letter of an unknown class without a class line", () => {
        const view = viewOfFrames(framesOf(frame({ jobId: "a", state: "dead_letter", at, failureClass: "strange" })))
        expect(jobStateOf(view, words)).toMatchObject({ label: "deadLetter", detail: null })
    })

    it("words done as a plain result and none as nothing", () => {
        expect(jobStateOf(viewOfFrames(framesOf(frame({ jobId: "a", state: "done", at }))), words)).toMatchObject({ label: "done", isDot: false, tone: "success" })
        expect(jobStateOf(NO_JOB_PROGRESS, words)).toBeNull()
    })
})

describe("isJobProgressFrame", () => {
    const ok = { id: "x", root: "knowledge-source:s1", jobId: "a", job: "knowledge.index", state: "running", at: "2026-11-14T10:00:00Z" }

    it("accepts the frame of the door, with or without its optional fields", () => {
        expect(isJobProgressFrame(ok)).toBe(true)
        expect(isJobProgressFrame({ ...ok, attempt: 2, done: 1, total: 4, labelKey: "knowledge.index.read" })).toBe(true)
    })

    it("refuses a frame with an unknown state, a missing id or a wrong optional type", () => {
        expect(isJobProgressFrame({ ...ok, state: "queued" })).toBe(false)
        expect(isJobProgressFrame({ ...ok, id: undefined })).toBe(false)
        expect(isJobProgressFrame({ ...ok, root: undefined })).toBe(false)
        expect(isJobProgressFrame({ ...ok, done: "3" })).toBe(false)
        expect(isJobProgressFrame(null)).toBe(false)
    })
})

describe("withRootFrame", () => {
    it("keeps each chain's jobs apart on one stream, the newest frame of a job winning", () => {
        const one = frame({ jobId: "a", root: "knowledge-source:s1", state: "running", at: "2026-11-14T10:00:00Z", labelKey: "knowledge.index.read" })
        const two = frame({ jobId: "a", root: "knowledge-source:s2", state: "retry", at: "2026-11-14T10:00:01Z", retryAt: "2026-11-14T10:10:00Z" })
        const older = frame({ jobId: "a", root: "knowledge-source:s1", state: "running", at: "2026-11-14T09:00:00Z" })
        const held = [one, two, older].reduce<JobFramesByRoot>(withRootFrame, {})
        expect(viewOfFrames(held["knowledge-source:s1"]).labelKey).toBe("knowledge.index.read")
        expect(viewOfFrames(held["knowledge-source:s2"])).toMatchObject({ state: "retry", retryAt: "2026-11-14T10:10:00Z" })
    })
})

describe("selectorOf", () => {
    const roots = (count: number): ReadonlyArray<string> =>
        Array.from({ length: count }, (_, index) => `knowledge-source:s${String(index)}`)

    it("asks for nothing while no chain is in view", () => {
        expect(selectorOf([])).toBeNull()
    })

    it("names the chains once each, in a stable order, as ONE request", () => {
        expect(selectorOf(["b:1", "a:2", "b:1"])).toEqual({ kind: "roots", roots: ["a:2", "b:1"] })
    })

    it("keeps fifty chains by name and follows the whole workspace past the door's limit", () => {
        expect(selectorOf(roots(JOB_PROGRESS_ROOTS_MAX))).toMatchObject({ kind: "roots" })
        expect(selectorOf(roots(JOB_PROGRESS_ROOTS_MAX + 1))).toEqual({ kind: "all" })
    })
})
