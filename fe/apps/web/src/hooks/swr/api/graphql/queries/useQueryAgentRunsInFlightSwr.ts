"use client"

import useSWR from "swr"
import { useWorkspaceKey } from "@/hooks/workspaceKey"
import { queryAgentRunsInFlight } from "@/modules/api/graphql/queries/query-agent-runs-in-flight"
import type { ReadResponse } from "@/hooks/workspaceread"
import type { AgentRunsInFlightQuery } from "@/modules/api"

/** The SWR key of the runs in flight of one conversation. */
export const QUERY_AGENT_RUNS_IN_FLIGHT_SWR_KEY = "QUERY_AGENT_RUNS_IN_FLIGHT_SWR"

/** The runs in flight that serve one customer conversation (null id: nothing is read). */
export const useQueryAgentRunsInFlightSwr = (
    conversationId: string | null,
    contactId: string | null = null,
): ReadResponse<AgentRunsInFlightQuery["agentRunsInFlight"]> =>
    useSWR(
        useWorkspaceKey(QUERY_AGENT_RUNS_IN_FLIGHT_SWR_KEY, [conversationId, contactId], conversationId !== null),
        async ({ signal }: { signal?: AbortSignal } = {}) => {
            if (conversationId === null) return []
            const result = await queryAgentRunsInFlight({ request: { conversationId, contactId }, signal })
            if (!result.data) throw new Error("agentRunsInFlight answered no data")
            return result.data.agentRunsInFlight
        },
    )
