"use client"

import { useTranslations } from "next-intl"
import { useState } from "react"
import {
    useMutateCloseStoppedWorkSwr,
    useMutateRequeueStoppedEventSwr,
    useMutateResumeStoppedWorkSwr,
} from "@/hooks/swr"
import { graphQLErrorCode, isNotFoundFailure, isRefusedByBackend } from "@/modules/failure"
import { eventOfJobId } from "@/modules/teamChat"
import { toast } from "@/modules/toast"
import type { TeamChatJobParkedAction } from "@/modules/types"

/** The view `useTeamChatJobs` returns. */
export interface TeamChatJobsView {
    /** The job whose action is in flight, or null. */
    readonly pendingId: string | null
    readonly act: (jobId: string, action: TeamChatJobParkedAction) => Promise<void>
}

/** The backend codes that say the job is no longer waiting for a person (a second close, a resume of a closed or handed-back job): a notice, not an error. */
const NOTHING_WAITING: ReadonlySet<string> = new Set(["JOB_OPS_STOPPED_WORK_ALREADY_CLOSED", "JOB_OPS_STOPPED_WORK_NOT_STOPPED"])

/**
 * What is done with the "job stopped" cards of the open room: "Run again" goes to `resumeStoppedWork` (a buried event's card, whose id is
 * `event:<queue>:<event id>`, goes to `requeueStoppedEvent`: the resume door takes only a job id) and "Close" to `closeStoppedWork` with
 * the reason the person gave. The doors answer true when they changed something; false says nothing was waiting any more (a notice, not an
 * error). After any press `onChanged` reads the thread again.
 */
export const useTeamChatJobs = (onChanged: () => void): TeamChatJobsView => {
    const t = useTranslations("teamChat")
    const resume = useMutateResumeStoppedWorkSwr()
    const close = useMutateCloseStoppedWorkSwr()
    const requeue = useMutateRequeueStoppedEventSwr()
    const [pendingId, setPendingId] = useState<string | null>(null)
    const done = (doneKey: "jobParked.toastResumed" | "jobParked.toastClosed"): void => void toast.success(t(doneKey))
    const gone = (): void => void toast.info(t("jobParked.toastGone"))
    const failed = (error: unknown): void => {
        if (isNotFoundFailure(error) || NOTHING_WAITING.has(graphQLErrorCode(error) ?? "")) return gone()
        const description = isRefusedByBackend(error) && error instanceof Error ? error.message : t("jobParked.failedText")
        toast.danger(t("jobParked.failedTitle"), { description })
    }
    const run = async (jobId: string, action: TeamChatJobParkedAction): Promise<void> => {
        if (action.kind === "close") {
            if (await close.trigger({ jobId, reason: action.reason })) done("jobParked.toastClosed")
            else gone()
            return
        }
        const event = eventOfJobId(jobId)
        const isChanged =
            event === null
                ? await resume.trigger({ jobId })
                : await requeue.trigger({ queue: event.queue, eventId: event.eventId })
        if (isChanged) done("jobParked.toastResumed")
        else gone()
    }
    return {
        pendingId,
        act: async (jobId, action) => {
            setPendingId(jobId)
            try {
                await run(jobId, action)
            } catch (error) {
                failed(error)
            }
            setPendingId(null)
            onChanged()
        },
    }
}
