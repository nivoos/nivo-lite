"use client"

import {
    mutateCloseStoppedWork,
    type mutateCloseStoppedWork as MutateCloseStoppedWorkOperation,
} from "@/modules/api/graphql/mutations/mutation-close-stopped-work"
import { answeredData } from "@/hooks/workspaceread"
import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"
import type { CloseStoppedWorkMutation } from "@/modules/api"

/** The SWR key of the closeStoppedWork mutation. */
export const MUTATE_CLOSE_STOPPED_WORK_SWR_KEY = "MUTATE_CLOSE_STOPPED_WORK_SWR"

/** SWR mutation for {@link mutateCloseStoppedWork}: Closes a stopped background job with a reason. `trigger(input)` answers the payload and rejects with the back end failure. */
export const useMutateCloseStoppedWorkSwr = (): SWRMutationResponse<
    CloseStoppedWorkMutation["closeStoppedWork"],
    Error,
    typeof MUTATE_CLOSE_STOPPED_WORK_SWR_KEY,
    TriggerArg["arg"]
> =>
    useSWRMutation(
        MUTATE_CLOSE_STOPPED_WORK_SWR_KEY,
        async (_key: string, { arg }: TriggerArg) =>
            answeredData(await mutateCloseStoppedWork({ request: arg }), MUTATE_CLOSE_STOPPED_WORK_SWR_KEY).closeStoppedWork,
    )

/** The request accepted by this operation trigger. */
interface TriggerArg {
    readonly arg: Parameters<typeof MutateCloseStoppedWorkOperation>[0]["request"]
}
