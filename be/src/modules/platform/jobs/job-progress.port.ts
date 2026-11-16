import type { ClaimedJob } from "./jobs.contracts"

/**
 * The topic a job (and every job of its chain) reports progress on: principal first (the workspace whose members may read it), then
 * the chain's ROOT (what the chain is about, `<kind>:<id>`, the same for every job of the chain: one stream from the first job to the
 * last). Keys only: no text a person reads travels on it.
 */
export interface JobProgressTopic {
    /** The principal of the topic: the workspace whose members may subscribe; the door authorises by it. */
    readonly workspaceId: string
    /** The chain's root, `<kind>:<id>` (e.g. a document a chain indexes, reads and syncs). */
    readonly root: string
}

/** The optional progress declaration of a job: the topic its state changes and step progress go to. */
export interface JobProgressDeclaration<P extends object> {
    /** The topic of a payload; every job of one chain answers the same root. */
    topic(payload: P): JobProgressTopic
}

/**
 * The port a domain method reports step progress through (it never publishes to the hub itself): the frame stores it on the job row
 * (so it survives a crash) and publishes it after commit to the job's topic when the job declares one; a job without a topic stores
 * it only. A publish failure never fails the job.
 */
export interface JobProgress {
    /** Reports `done` of `total` units of the job's current step, with a label KEY the fe's catalogue words (`<job>.<step>`). */
    report(job: ClaimedJob, done: number, total: number, labelKey: string): Promise<void>
}
