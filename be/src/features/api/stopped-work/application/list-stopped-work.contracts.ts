import type { StoppedWorkView } from "@modules/domain/job-ops"

/** What listing stopped work takes: the workspace. */
export interface ListStoppedWorkRequest {
    /** The workspace whose stopped jobs to list; the caller must own it. */
    readonly workspaceId: string
}

/** What listing stopped work answers: the workspace's parked jobs, oldest first. */
export type ListStoppedWorkResult = ReadonlyArray<StoppedWorkView>
