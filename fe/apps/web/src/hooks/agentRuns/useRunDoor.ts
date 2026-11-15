"use client"

import { useTranslations } from "next-intl"
import { useCallback } from "react"
import { useMutateCancelAgentRunSwr, useMutatePauseAgentRunSwr, useMutateResumeAgentRunSwr } from "@/hooks/swr"
import { toast, useGraphQLWithToast } from "@/modules/toast"

/** The three commands on one run in flight, and whether each is in flight. */
export interface RunDoorData {
    /** Ends the run; `tellCustomer` asks the agent for one short line to the customer. */
    readonly end: (runId: string, tellCustomer: boolean) => Promise<void>
    readonly pause: (runId: string) => Promise<void>
    readonly resume: (runId: string) => Promise<void>
    readonly isEnding: boolean
    readonly isPausing: boolean
    readonly isResuming: boolean
}

/** The kinds that mean the command did what was asked. */
const DONE_KINDS: ReadonlySet<string> = new Set(["ended", "paused", "resumed"])

/**
 * The commands that end, pause and resume one run, each answered by a toast (the kind the door answers, in words). After every command
 * `onDone` runs, so the caller reads its data again and no button is left standing for a state the run no longer has.
 */
export const useRunDoor = (onDone: () => void): RunDoorData => {
    const t = useTranslations("runDoor")
    const run = useGraphQLWithToast()
    const cancelRun = useMutateCancelAgentRunSwr()
    const pauseRun = useMutatePauseAgentRunSwr()
    const resumeRun = useMutateResumeAgentRunSwr()
    const tell = useCallback(
        (kind: string | undefined): void => {
            if (kind === undefined) return
            const message = t(
                (
                    {
                        ended: "toastEnded",
                        already_ended: "toastAlreadyEnded",
                        not_found: "toastNotFound",
                        paused: "toastPaused",
                        already_paused: "toastAlreadyPaused",
                        resumed: "toastResumed",
                        not_paused: "toastNotPaused",
                    } as const
                )[kind as "ended"] ?? "toastNotFound",
            )
            if (DONE_KINDS.has(kind)) toast.success(message)
            else toast.info(message)
        },
        [t],
    )
    const end = useCallback(
        async (runId: string, tellCustomer: boolean): Promise<void> => {
            const answer = await run(() => cancelRun.trigger({ runId, tellCustomer }), { showSuccessToast: false })
            tell(answer?.kind)
            onDone()
        },
        [run, cancelRun, tell, onDone],
    )
    const pause = useCallback(
        async (runId: string): Promise<void> => {
            const answer = await run(() => pauseRun.trigger({ runId }), { showSuccessToast: false })
            tell(answer?.kind)
            onDone()
        },
        [run, pauseRun, tell, onDone],
    )
    const resume = useCallback(
        async (runId: string): Promise<void> => {
            const answer = await run(() => resumeRun.trigger({ runId }), { showSuccessToast: false })
            tell(answer?.kind)
            onDone()
        },
        [run, resumeRun, tell, onDone],
    )
    return {
        end,
        pause,
        resume,
        isEnding: cancelRun.isMutating,
        isPausing: pauseRun.isMutating,
        isResuming: resumeRun.isMutating,
    }
}
