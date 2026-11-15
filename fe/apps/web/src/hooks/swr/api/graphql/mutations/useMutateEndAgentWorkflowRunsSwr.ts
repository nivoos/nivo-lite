"use client"

import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"
import { mutateEndAgentWorkflowRuns, type MutateEndAgentWorkflowRunsRequest } from "@/modules/api/graphql/mutations/mutation-end-agent-workflow-runs"
import type { EndAgentWorkflowRunsMutation } from "@/modules/api"

/** What the EndAgentWorkflowRuns mutation is triggered with. */
interface EndAgentWorkflowRunsArg {
    readonly arg: MutateEndAgentWorkflowRunsRequest
}

/** The SWR key of {@link useMutateEndAgentWorkflowRunsSwr}. */
export const MUTATE_END_AGENT_WORKFLOW_RUNS_SWR_KEY = "MUTATE_END_AGENT_WORKFLOW_RUNS_SWR"

/** SWR mutation for {@link mutateEndAgentWorkflowRuns}: `trigger(request)` answers the payload and rejects with the back end failure. */
export const useMutateEndAgentWorkflowRunsSwr = (): SWRMutationResponse<EndAgentWorkflowRunsMutation["endAgentWorkflowRuns"], Error, typeof MUTATE_END_AGENT_WORKFLOW_RUNS_SWR_KEY, EndAgentWorkflowRunsArg["arg"]> =>
    useSWRMutation(MUTATE_END_AGENT_WORKFLOW_RUNS_SWR_KEY, async (_key: string, { arg }: EndAgentWorkflowRunsArg) => {
        const result = await mutateEndAgentWorkflowRuns({ request: arg })
        if (!result.data) throw new Error("endAgentWorkflowRuns answered no data")
        return result.data.endAgentWorkflowRuns
    })
