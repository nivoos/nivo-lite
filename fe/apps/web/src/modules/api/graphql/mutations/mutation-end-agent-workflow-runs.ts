import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type InputVariables, type MutateParams, type WireInput } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type { EndAgentWorkflowRunsMutation, EndAgentWorkflowRunsMutationVariables } from "../__generated__/graphql"

/** The input of the `endAgentWorkflowRuns` mutation. */
export type MutateEndAgentWorkflowRunsRequest = WireInput<EndAgentWorkflowRunsMutationVariables["input"]>

type MutateEndAgentWorkflowRunsResponse = EndAgentWorkflowRunsMutation

const mutation1: TypedDocumentNode<MutateEndAgentWorkflowRunsResponse, InputVariables<MutateEndAgentWorkflowRunsRequest>> = gql`
    mutation EndAgentWorkflowRuns($input: EndAgentWorkflowRunsInput!) {
        endAgentWorkflowRuns(input: $input) {
            ended
        }
    }
`

enum MutationEndAgentWorkflowRuns {
    Mutation1 = "mutation1",
}

const mutationMap: Record<MutationEndAgentWorkflowRuns, TypedDocumentNode<MutateEndAgentWorkflowRunsResponse, InputVariables<MutateEndAgentWorkflowRunsRequest>>> = {
    [MutationEndAgentWorkflowRuns.Mutation1]: mutation1,
}

/** The back end `endAgentWorkflowRuns` mutation. Ends every run of a workflow in flight. */
export const mutateEndAgentWorkflowRuns = async ({
    mutation = MutationEndAgentWorkflowRuns.Mutation1,
    request,
    signal,
}: MutateParams<MutationEndAgentWorkflowRuns, MutateEndAgentWorkflowRunsRequest>): Promise<ApolloClient.MutateResult<MutateEndAgentWorkflowRunsResponse>> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.mutate({ mutation: mutationMap[mutation], variables: { input: request } })
}
