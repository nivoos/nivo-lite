"use client"

import { useSWRConfig } from "swr"
import useSWRSubscription, { type SWRSubscriptionResponse } from "swr/subscription"
import { useViewerKeyId, useWorkspaceKey } from "@/hooks/workspaceKey"
import { streamJobProgress } from "@/modules/api/sse/jobs/stream-job-progress"
import { selectorOf, withRootFrame, type JobFramesByRoot, type JobProgressSelector } from "@/modules/jobProgress"
import { matchesSwrKey } from "@/modules/utils"

/** The SWR key of the job-progress streams; the full key carries the workspace, the signed-in member and the chains followed. */
export const SUBSCRIBE_JOB_PROGRESS_SWR_KEY = "SUBSCRIBE_JOB_PROGRESS_SWR"

/** The key of the streams; null while nobody is signed in, no workspace is active or no chain is followed. */
type JobProgressStreamKey = readonly [string, string, ...Array<string | null>] | null

/** Separates the roots in the key of the subscription (a root never holds a line break). */
const ROOT_SEPARATOR = "\n"

/** The key part of a stream that follows every chain of the workspace (no root ever is this). */
const ALL_ROOTS = "*"

/** What the subscription holds: the newest frame of each job, by chain root. */
const NOTHING: JobFramesByRoot = {}

/** The selector a key part stands for. */
const selectorOfKey = (part: string): JobProgressSelector =>
    part === ALL_ROOTS ? { kind: "all" } : { kind: "roots", roots: part.split(ROOT_SEPARATOR) }

/** The key part that names what a selector follows. */
const keyPartOf = (selector: JobProgressSelector | null): string => {
    if (selector === null) return ""
    return selector.kind === "all" ? ALL_ROOTS : selector.roots.join(ROOT_SEPARATOR)
}

/**
 * The progress of the chains of jobs in view (their roots, `<kind>:<id>`), pushed by the generic job-progress door on ONE connection:
 * for each chain the current state of each job first (a retry with its time), then live frames, each naming its chain (the shared
 * client reconnects with `Last-Event-ID`). A change of the chains in view opens the stream again with the new list, which reads the
 * current state first, so nothing is lost; past the door's limit of 50 chains the stream follows the whole workspace and the set no
 * longer reopens it. Each (re)open reads the stored state once (the SWR read named by `storedRead`, the one that holds these chains'
 * state in the database), which closes the gap since the last frame. Nobody signed in, no workspace or no root, no stream.
 */
export const useSubscribeJobProgressSwr = (
    roots: ReadonlyArray<string>,
    storedRead: string,
): SWRSubscriptionResponse<JobFramesByRoot, Error> => {
    const viewerId = useViewerKeyId()
    const { mutate } = useSWRConfig()
    const followed = keyPartOf(selectorOf(roots))
    const key = useWorkspaceKey(
        SUBSCRIBE_JOB_PROGRESS_SWR_KEY,
        [viewerId ?? null, storedRead, followed],
        followed !== "" && viewerId !== undefined && viewerId !== "signed-out",
    )
    return useSWRSubscription<JobFramesByRoot, Error, JobProgressStreamKey>(key, ([, , , , part], { next }) => {
        const controller = new AbortController()
        void streamJobProgress({
            selector: selectorOfKey(part ?? ""),
            signal: controller.signal,
            onOpen: () => void mutate(matchesSwrKey(storedRead)),
            onFrame: (frame) => next(null, (held) => withRootFrame(held ?? NOTHING, frame)),
        })
        return () => controller.abort()
    })
}
