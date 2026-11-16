import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type InputVariables, type QueryParams, type WireInput } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type { AgentRunsInFlightQuery, AgentRunsInFlightQueryVariables } from "../__generated__/graphql"

/** The input of the `agentRunsInFlight` query. */
export type QueryAgentRunsInFlightRequest = WireInput<AgentRunsInFlightQueryVariables["input"]>

type QueryAgentRunsInFlightResponse = AgentRunsInFlightQuery

const query1: TypedDocumentNode<QueryAgentRunsInFlightResponse, InputVariables<QueryAgentRunsInFlightRequest>> = gql`
    query AgentRunsInFlight($input: AgentRunsInFlightInput!) {
        agentRunsInFlight(input: $input) {
            runId
            agentId
            status
        }
    }
`

enum QueryAgentRunsInFlight {
    Query1 = "query1",
}

const queryMap: Record<QueryAgentRunsInFlight, TypedDocumentNode<QueryAgentRunsInFlightResponse, InputVariables<QueryAgentRunsInFlightRequest>>> = {
    [QueryAgentRunsInFlight.Query1]: query1,
}

/** The back end `agentRunsInFlight` query: the runs in flight that serve one customer conversation. */
export const queryAgentRunsInFlight = async ({
    query = QueryAgentRunsInFlight.Query1,
    request,
    signal,
}: QueryParams<QueryAgentRunsInFlight, QueryAgentRunsInFlightRequest> & { request: QueryAgentRunsInFlightRequest }): Promise<ApolloClient.QueryResult<QueryAgentRunsInFlightResponse>> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.query({ query: queryMap[query], variables: { input: request }, fetchPolicy: "no-cache" })
}
