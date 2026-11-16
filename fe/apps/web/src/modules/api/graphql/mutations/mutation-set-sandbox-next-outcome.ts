import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type InputVariables, type MutateParams, type WireInput } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type { SetSandboxNextOutcomeMutation, SetSandboxNextOutcomeMutationVariables } from "../__generated__/graphql"

/** The input of the `setSandboxNextOutcome` mutation. */
export type MutateSetSandboxNextOutcomeRequest = WireInput<SetSandboxNextOutcomeMutationVariables["input"]>

/** The response of the `setSandboxNextOutcome` mutation: the typed payload straight from the back end contract. */
type MutateSetSandboxNextOutcomeResponse = SetSandboxNextOutcomeMutation

type Document = TypedDocumentNode<MutateSetSandboxNextOutcomeResponse, InputVariables<MutateSetSandboxNextOutcomeRequest>>

const mutation1: Document = gql`
    mutation SetSandboxNextOutcome($input: SetSandboxNextOutcomeInput!) {
        setSandboxNextOutcome(input: $input) {
            operation
            caseId
            isDefault
        }
    }
`

enum MutationSetSandboxNextOutcome {
    Mutation1 = "mutation1",
}

const mutationMap: Record<MutationSetSandboxNextOutcome, Document> = { [MutationSetSandboxNextOutcome.Mutation1]: mutation1 }

/** Apollo params for {@link mutateSetSandboxNextOutcome}. */
type MutateSetSandboxNextOutcomeParams = MutateParams<MutationSetSandboxNextOutcome, MutateSetSandboxNextOutcomeRequest>

/** Picks the outcome an outbound operation of a sandbox account answers next (the back end `setSandboxNextOutcome` mutation, owner and manager; sticky until changed). */
export const mutateSetSandboxNextOutcome = async ({
    mutation = MutationSetSandboxNextOutcome.Mutation1,
    request,
    signal,
}: MutateSetSandboxNextOutcomeParams): Promise<ApolloClient.MutateResult<MutateSetSandboxNextOutcomeResponse>> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.mutate({ mutation: mutationMap[mutation], variables: { input: request } })
}
