import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type InputVariables, type MutateParams, type WireInput } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type { SetContactDoNotContactMutation, SetContactDoNotContactMutationVariables } from "../__generated__/graphql"

/** The input of the `setContactDoNotContact` mutation. */
type MutateSetContactDoNotContactRequest = WireInput<SetContactDoNotContactMutationVariables["input"]>

/** The response of the `setContactDoNotContact` mutation: the typed payload straight from the back end contract. */
type MutateSetContactDoNotContactResponse = SetContactDoNotContactMutation

type Document = TypedDocumentNode<MutateSetContactDoNotContactResponse, InputVariables<MutateSetContactDoNotContactRequest>>

const mutation1: Document = gql`
    mutation SetContactDoNotContact($input: SetContactDoNotContactInput!) {
        setContactDoNotContact(input: $input) {
            outcome
            consent {
                doNotContact
                at
                by {
                    kind
                    id
                    name
                }
                reason
            }
        }
    }
`

enum MutationSetContactDoNotContact {
    Mutation1 = "mutation1",
}

const mutationMap: Record<MutationSetContactDoNotContact, Document> = {
    [MutationSetContactDoNotContact.Mutation1]: mutation1,
}

/** Apollo params for {@link mutateSetContactDoNotContact}. */
type MutateSetContactDoNotContactParams = MutateParams<MutationSetContactDoNotContact, MutateSetContactDoNotContactRequest>

/** Sets or clears the mark that says the agents may not message a person first (the back end `setContactDoNotContact` mutation, owner or manager); the answer says whether it was set, unchanged or the person is gone. */
export const mutateSetContactDoNotContact = async ({
    mutation = MutationSetContactDoNotContact.Mutation1,
    request,
    signal,
}: MutateSetContactDoNotContactParams): Promise<ApolloClient.MutateResult<MutateSetContactDoNotContactResponse>> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.mutate({ mutation: mutationMap[mutation], variables: { input: request } })
}
