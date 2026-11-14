import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type InputVariables, type MutateParams, type WireInput } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type { RequeueStoppedEventMutation, RequeueStoppedEventMutationVariables } from "../__generated__/graphql"

/** The input of the `requeueStoppedEvent` mutation. */
type MutateRequeueStoppedEventRequest = WireInput<RequeueStoppedEventMutationVariables["input"]>

/** The response of the `requeueStoppedEvent` mutation: the typed payload straight from the back end contract. */
type MutateRequeueStoppedEventResponse = RequeueStoppedEventMutation

type Document = TypedDocumentNode<MutateRequeueStoppedEventResponse, InputVariables<MutateRequeueStoppedEventRequest>>

const mutation1: Document = gql`
    mutation RequeueStoppedEvent($input: RequeueStoppedEventInput!) {
        requeueStoppedEvent(input: $input)
    }
`

enum MutationRequeueStoppedEvent {
    Mutation1 = "mutation1",
}

const mutationMap: Record<MutationRequeueStoppedEvent, Document> = {
    [MutationRequeueStoppedEvent.Mutation1]: mutation1,
}

/** Apollo params for {@link mutateRequeueStoppedEvent}. */
type MutateRequeueStoppedEventParams = MutateParams<MutationRequeueStoppedEvent, MutateRequeueStoppedEventRequest>

/** Puts a buried event back on its queue (the back end `requeueStoppedEvent` mutation, owner or manager). */
export const mutateRequeueStoppedEvent = async ({
    mutation = MutationRequeueStoppedEvent.Mutation1,
    request,
    signal,
}: MutateRequeueStoppedEventParams): Promise<ApolloClient.MutateResult<MutateRequeueStoppedEventResponse>> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.mutate({ mutation: mutationMap[mutation], variables: { input: request } })
}
