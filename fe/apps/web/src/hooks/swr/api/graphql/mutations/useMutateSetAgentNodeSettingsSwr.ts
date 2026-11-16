"use client"

import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"
import {
    mutateSetAgentNodeSettings,
    type MutateSetAgentNodeSettingsRequest,
} from "@/modules/api/graphql/mutations/mutation-set-agent-node-settings"
import type { SetAgentNodeSettingsMutation } from "@/modules/api"

/** What the SetAgentNodeSettings mutation is triggered with. */
interface SetAgentNodeSettingsArg {
    readonly arg: MutateSetAgentNodeSettingsRequest
}

/** The SWR key of {@link useMutateSetAgentNodeSettingsSwr}. */
export const MUTATE_SET_AGENT_NODE_SETTINGS_SWR_KEY = "MUTATE_SET_AGENT_NODE_SETTINGS_SWR"

/** SWR mutation for {@link mutateSetAgentNodeSettings}: `trigger(request)` answers the payload and rejects with the back end failure. */
export const useMutateSetAgentNodeSettingsSwr = (): SWRMutationResponse<
    SetAgentNodeSettingsMutation["setAgentNodeSettings"],
    Error,
    typeof MUTATE_SET_AGENT_NODE_SETTINGS_SWR_KEY,
    SetAgentNodeSettingsArg["arg"]
> =>
    useSWRMutation(MUTATE_SET_AGENT_NODE_SETTINGS_SWR_KEY, async (_key: string, { arg }: SetAgentNodeSettingsArg) => {
        const result = await mutateSetAgentNodeSettings({ request: arg })
        if (!result.data) throw new Error("setAgentNodeSettings answered no data")
        return result.data.setAgentNodeSettings
    })
