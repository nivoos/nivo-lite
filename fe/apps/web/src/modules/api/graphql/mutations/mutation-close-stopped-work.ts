import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type InputVariables, type MutateParams, type WireInput } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type { CloseStoppedWorkMutation, CloseStoppedWorkMutationVariables } from "../__generated__/graphql"

/** The input of the `closeStoppedWork` mutation. */
type MutateCloseStoppedWorkRequest = WireInput<CloseStoppedWorkMutationVariables["input"]>

/** The response of the `closeStoppedWork` mutation: the typed payload straight from the back end contract. */
type MutateCloseStoppedWorkResponse = CloseStoppedWorkMutation

type Document = TypedDocumentNode<MutateCloseStoppedWorkResponse, InputVariables<MutateCloseStoppedWorkRequest>>

const mutation1: Document = gql`
    mutation CloseStoppedWork($input: CloseStoppedWorkInput!) {
        closeStoppedWork(input: $input)
    }
`

enum MutationCloseStoppedWork {
    Mutation1 = "mutation1",
}

const mutationMap: Record<MutationCloseStoppedWork, Document> = {
    [MutationCloseStoppedWork.Mutation1]: mutation1,
}

/** Apollo params for {@link mutateCloseStoppedWork}. */
type MutateCloseStoppedWorkParams = MutateParams<MutationCloseStoppedWork, MutateCloseStoppedWorkRequest>

/** Closes a stopped background job for good with the reason a person gave (the back end `closeStoppedWork` mutation, owner or manager). */
export const mutateCloseStoppedWork = async ({
    mutation = MutationCloseStoppedWork.Mutation1,
    request,
    signal,
}: MutateCloseStoppedWorkParams): Promise<ApolloClient.MutateResult<MutateCloseStoppedWorkResponse>> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.mutate({ mutation: mutationMap[mutation], variables: { input: request } })
}
