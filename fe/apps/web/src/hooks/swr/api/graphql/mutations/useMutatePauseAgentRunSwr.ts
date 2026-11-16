"use client"

import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"
import { mutatePauseAgentRun, type MutatePauseAgentRunRequest } from "@/modules/api/graphql/mutations/mutation-pause-agent-run"
import type { PauseAgentRunMutation } from "@/modules/api"

/** What the PauseAgentRun mutation is triggered with. */
interface PauseAgentRunArg {
    readonly arg: MutatePauseAgentRunRequest
}

/** The SWR key of {@link useMutatePauseAgentRunSwr}. */
export const MUTATE_PAUSE_AGENT_RUN_SWR_KEY = "MUTATE_PAUSE_AGENT_RUN_SWR"

/** SWR mutation for {@link mutatePauseAgentRun}: `trigger(request)` answers the payload and rejects with the back end failure. */
export const useMutatePauseAgentRunSwr = (): SWRMutationResponse<PauseAgentRunMutation["pauseAgentRun"], Error, typeof MUTATE_PAUSE_AGENT_RUN_SWR_KEY, PauseAgentRunArg["arg"]> =>
    useSWRMutation(MUTATE_PAUSE_AGENT_RUN_SWR_KEY, async (_key: string, { arg }: PauseAgentRunArg) => {
        const result = await mutatePauseAgentRun({ request: arg })
        if (!result.data) throw new Error("pauseAgentRun answered no data")
        return result.data.pauseAgentRun
    })
