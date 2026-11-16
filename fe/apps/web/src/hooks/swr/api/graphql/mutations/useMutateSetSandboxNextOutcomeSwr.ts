"use client"

import {
    mutateSetSandboxNextOutcome,
    type MutateSetSandboxNextOutcomeRequest,
} from "@/modules/api/graphql/mutations/mutation-set-sandbox-next-outcome"
import { answeredData } from "@/hooks/workspaceread"
import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"
import type { SetSandboxNextOutcomeMutation } from "@/modules/api"

/** The SWR key of the setSandboxNextOutcome mutation. */
export const MUTATE_SET_SANDBOX_NEXT_OUTCOME_SWR_KEY = "MUTATE_SET_SANDBOX_NEXT_OUTCOME_SWR"

/** SWR mutation for {@link mutateSetSandboxNextOutcome}: Picks the outcome an outbound operation of a sandbox account answers next (sticky until changed). `trigger(request)` answers the payload and rejects with the back end failure. */
export const useMutateSetSandboxNextOutcomeSwr = (): SWRMutationResponse<
    SetSandboxNextOutcomeMutation["setSandboxNextOutcome"],
    Error,
    typeof MUTATE_SET_SANDBOX_NEXT_OUTCOME_SWR_KEY,
    MutateSetSandboxNextOutcomeRequest
> =>
    useSWRMutation(
        MUTATE_SET_SANDBOX_NEXT_OUTCOME_SWR_KEY,
        async (_key: string, { arg }: TriggerArg) =>
            answeredData(await mutateSetSandboxNextOutcome({ request: arg }), MUTATE_SET_SANDBOX_NEXT_OUTCOME_SWR_KEY).setSandboxNextOutcome,
    )

/** The request accepted by this operation trigger. */
interface TriggerArg {
    readonly arg: MutateSetSandboxNextOutcomeRequest
}
