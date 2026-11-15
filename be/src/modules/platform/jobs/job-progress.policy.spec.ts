import {
    frameOfRow,
    isJobProgressFrame,
    JOB_PROGRESS_MAX_ROOTS,
    JOB_PROGRESS_ROOT_PATTERN,
    JOB_PROGRESS_ROOTS_PATTERN,
    jobProgressChainsLike,
    jobProgressFrameId,
    jobProgressRootsOf,
    jobProgressTopic,
    jobProgressTopicName,
    jobProgressTopicOfName,
    type JobProgressRow,
} from "./job-progress.policy"
import { closedErrorOf } from "./parked-job-resume.policy"

const row = (changes: Partial<JobProgressRow> = {}): JobProgressRow => ({
    id: "j-1",
    kind: "knowledge.index",
    progressTopic: "job-progress:ws-1:knowledge-source:s1",
    status: "running",
    failureClass: null,
    progressDone: null,
    progressTotal: null,
    progressLabel: null,
    progressAt: null,
    progressRetryAt: null,
    error: null,
    updatedAt: new Date("2026-11-14T10:00:00.000Z"),
    ...changes,
})

describe("job progress topic", () => {
    it("names a chain by the workspace first and then the root, workspace in lower case, and reads the name back", () => {
        const name = jobProgressTopicName({ workspaceId: "WS-1", root: "knowledge-source:s1" })

        expect(name).toBe("job-progress:ws-1:knowledge-source:s1")
        expect(jobProgressTopicOfName(name)).toEqual({ workspaceId: "ws-1", root: "knowledge-source:s1" })
        expect(jobProgressTopicOfName("job-progress:ws-1")).toBeUndefined()
        expect(jobProgressTopicOfName("other:ws-1:a:b")).toBeUndefined()
        expect(jobProgressTopicOfName("job-progress:ws-1:no-colon")).toBeUndefined()
    })

    it("has ONE hub topic per workspace, whatever the chain", () => {
        expect(jobProgressTopic("WS-1").name).toBe("job-progress:ws-1")
        expect(jobProgressTopic("ws-1").name).not.toBe(jobProgressTopic("ws-2").name)
    })

    it("escapes the wildcards of a workspace id in the pattern that finds its chains", () => {
        expect(jobProgressChainsLike("WS_1")).toBe("job-progress:ws\\_1:%")
        expect(jobProgressChainsLike("a%b")).toBe("job-progress:a\\%b:%")
    })

    it("accepts only well formed roots", () => {
        expect(JOB_PROGRESS_ROOT_PATTERN.test("knowledge-source:3f2a")).toBe(true)
        expect(JOB_PROGRESS_ROOT_PATTERN.test("no-colon")).toBe(false)
        expect(JOB_PROGRESS_ROOT_PATTERN.test("a b:c")).toBe(false)
    })

    it("accepts a list of at most the bound of roots, comma separated, none empty", () => {
        const list = (count: number): string => Array.from({ length: count }, (_, index) => `k:${index}`).join(",")

        expect(JOB_PROGRESS_ROOTS_PATTERN.test("k:1")).toBe(true)
        expect(JOB_PROGRESS_ROOTS_PATTERN.test(list(JOB_PROGRESS_MAX_ROOTS))).toBe(true)
        expect(JOB_PROGRESS_ROOTS_PATTERN.test(list(JOB_PROGRESS_MAX_ROOTS + 1))).toBe(false)
        expect(JOB_PROGRESS_ROOTS_PATTERN.test("k:1,")).toBe(false)
        expect(JOB_PROGRESS_ROOTS_PATTERN.test("k:1,bad")).toBe(false)
    })

    it("reads the asked roots as one list without repeats, none asked meaning the whole workspace", () => {
        expect(jobProgressRootsOf({ workspaceId: "ws-1", root: "k:1" })).toEqual(["k:1"])
        expect(jobProgressRootsOf({ workspaceId: "ws-1", roots: "k:1,k:2,k:1" })).toEqual(["k:1", "k:2"])
        expect(jobProgressRootsOf({ workspaceId: "ws-1" })).toEqual([])
    })
})

describe("isJobProgressFrame", () => {
    const frame = { id: "x", kind: "job", root: "k:1", job: "j", jobId: "1", state: "running", at: "2026-11-14T10:00:00.000Z" }

    it("accepts a frame with and without optional fields", () => {
        expect(isJobProgressFrame(frame)).toBe(true)
        expect(isJobProgressFrame({ ...frame, attempt: 2, done: 1, total: 4, labelKey: "k" })).toBe(true)
    })

    it("refuses a foreign state, a wrong kind and a mistyped optional field", () => {
        expect(isJobProgressFrame({ ...frame, state: "paused" })).toBe(false)
        expect(isJobProgressFrame({ ...frame, kind: "progress" })).toBe(false)
        expect(isJobProgressFrame({ ...frame, done: "1" })).toBe(false)
        expect(isJobProgressFrame({ ...frame, root: undefined })).toBe(false)
        expect(isJobProgressFrame(null)).toBe(false)
    })
})

describe("frameOfRow", () => {
    it("tells each status as its frame state", () => {
        expect(frameOfRow(row({ status: "done" }))?.state).toBe("done")
        expect(frameOfRow(row({ status: "failed" }))?.state).toBe("retry")
        expect(frameOfRow(row({ status: "running" }))?.state).toBe("running")
        // A person's close ends the chain: it is `closed`, never the `retry` a job handed back to its queue shows (status `failed`, no error).
        expect(frameOfRow(row({ status: "failed", error: closedErrorOf("old payment") }))?.state).toBe("closed")
        expect(frameOfRow(row({ status: "failed", error: "boom" }))?.state).toBe("retry")
        const parked = frameOfRow(row({ status: "failed_awaiting_fix", failureClass: "config" }))
        expect(parked).toMatchObject({ state: "dead_letter", failureClass: "config" })
    })

    it("carries the last step report of a running row, keys and numbers only", () => {
        const at = new Date("2026-11-14T10:05:00.000Z")
        const frame = frameOfRow(row({ progressDone: 2, progressTotal: 5, progressLabel: "embed", progressAt: at }))

        expect(frame).toMatchObject({ done: 2, total: 5, labelKey: "embed", at: at.toISOString() })
        expect(isJobProgressFrame(frame)).toBe(true)
    })

    it("carries the root of the chain the row records", () => {
        expect(frameOfRow(row())).toMatchObject({ root: "knowledge-source:s1" })
    })

    it("tells nothing for a row with no chain name", () => {
        expect(frameOfRow(row({ progressTopic: null }))).toBeUndefined()
        expect(frameOfRow(row({ progressTopic: "not-a-chain" }))).toBeUndefined()
    })

    it("carries the time a waiting retry runs again, only in state retry", () => {
        const retryAt = new Date("2026-11-14T10:00:30.000Z")

        expect(frameOfRow(row({ status: "failed", progressRetryAt: retryAt }))).toMatchObject({ state: "retry", retryAt: retryAt.toISOString() })
        expect(frameOfRow(row({ status: "failed" }))?.retryAt).toBeUndefined()
        expect(frameOfRow(row({ status: "done", progressRetryAt: retryAt }))?.retryAt).toBeUndefined()
    })

    it("tells no step numbers once the row is done", () => {
        const frame = frameOfRow(row({ status: "done", progressDone: 5, progressTotal: 5, progressLabel: "embed" }))

        expect(frame?.done).toBeUndefined()
    })

    it("gives a frame id that differs per state and per step count", () => {
        const at = "2026-11-14T10:00:00.000Z"
        const a = jobProgressFrameId({ jobId: "1", state: "running", attempt: 1, done: undefined, at })
        const b = jobProgressFrameId({ jobId: "1", state: "running", attempt: 1, done: 3, at })
        const c = jobProgressFrameId({ jobId: "1", state: "done", attempt: undefined, done: undefined, at })

        expect(new Set([a, b, c]).size).toBe(3)
    })
})
