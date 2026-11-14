/** The longest reason a person gives when closing stopped work. */
export const CLOSE_REASON_MAX = 500

/** The most stopped jobs one listing answers. */
export const STOPPED_WORK_LIMIT = 200

/** One stopped job of a workspace as its owner reads it. */
export interface StoppedWorkView {
    /** The job row. */
    readonly jobId: string
    /** The job's name. */
    readonly job: string
    /** Why it will not run on its own. */
    readonly failureClass: "transient" | "input" | "code" | "config"
    /** The failure code. */
    readonly reason: string
    /** When it stopped, ISO 8601. */
    readonly parkedAt: string
    /** How many times a person handed it back. */
    readonly resumeCount: number
}
