"use client"

import {
    mutateResumeStoppedWork,
    type mutateResumeStoppedWork as MutateResumeStoppedWorkOperation,
} from "@/modules/api/graphql/mutations/mutation-resume-stopped-work"
import { answeredData } from "@/hooks/workspaceread"
import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"
import type { ResumeStoppedWorkMutation } from "@/modules/api"

/** The SWR key of the resumeStoppedWork mutation. */
export const MUTATE_RESUME_STOPPED_WORK_SWR_KEY = "MUTATE_RESUME_STOPPED_WORK_SWR"

/** SWR mutation for {@link mutateResumeStoppedWork}: Runs a stopped background job again. `trigger(input)` answers the payload and rejects with the back end failure. */
export const useMutateResumeStoppedWorkSwr = (): SWRMutationResponse<
    ResumeStoppedWorkMutation["resumeStoppedWork"],
    Error,
    typeof MUTATE_RESUME_STOPPED_WORK_SWR_KEY,
    TriggerArg["arg"]
> =>
    useSWRMutation(
        MUTATE_RESUME_STOPPED_WORK_SWR_KEY,
        async (_key: string, { arg }: TriggerArg) =>
            answeredData(await mutateResumeStoppedWork({ request: arg }), MUTATE_RESUME_STOPPED_WORK_SWR_KEY).resumeStoppedWork,
    )

/** The request accepted by this operation trigger. */
interface TriggerArg {
    readonly arg: Parameters<typeof MutateResumeStoppedWorkOperation>[0]["request"]
}
