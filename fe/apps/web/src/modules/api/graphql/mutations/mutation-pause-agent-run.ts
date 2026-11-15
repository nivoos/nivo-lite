import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type InputVariables, type MutateParams, type WireInput } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type { PauseAgentRunMutation, PauseAgentRunMutationVariables } from "../__generated__/graphql"

/** The input of the `pauseAgentRun` mutation. */
export type MutatePauseAgentRunRequest = WireInput<PauseAgentRunMutationVariables["input"]>

type MutatePauseAgentRunResponse = PauseAgentRunMutation

const mutation1: TypedDocumentNode<MutatePauseAgentRunResponse, InputVariables<MutatePauseAgentRunRequest>> = gql`
    mutation PauseAgentRun($input: AgentRunPauseInput!) {
        pauseAgentRun(input: $input) {
            kind
        }
    }
`

enum MutationPauseAgentRun {
    Mutation1 = "mutation1",
}

const mutationMap: Record<MutationPauseAgentRun, TypedDocumentNode<MutatePauseAgentRunResponse, InputVariables<MutatePauseAgentRunRequest>>> = {
    [MutationPauseAgentRun.Mutation1]: mutation1,
}

/** The back end `pauseAgentRun` mutation. Pauses a run in flight: no further step until resumed. */
export const mutatePauseAgentRun = async ({
    mutation = MutationPauseAgentRun.Mutation1,
    request,
    signal,
}: MutateParams<MutationPauseAgentRun, MutatePauseAgentRunRequest>): Promise<ApolloClient.MutateResult<MutatePauseAgentRunResponse>> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.mutate({ mutation: mutationMap[mutation], variables: { input: request } })
}
