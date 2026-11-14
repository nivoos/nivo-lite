import type { StoppedEventView } from "@modules/domain/job-ops"

/** What listing stopped events takes: the workspace. */
export interface ListStoppedEventsRequest {
    /** The workspace whose buried events to list; the caller must own it. */
    readonly workspaceId: string
}

/** What listing stopped events answers: the workspace's buried events. */
export type ListStoppedEventsResult = ReadonlyArray<StoppedEventView>
