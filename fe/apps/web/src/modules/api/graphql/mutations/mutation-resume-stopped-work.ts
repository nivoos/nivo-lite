import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type InputVariables, type MutateParams, type WireInput } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type { ResumeStoppedWorkMutation, ResumeStoppedWorkMutationVariables } from "../__generated__/graphql"

/** The input of the `resumeStoppedWork` mutation. */
type MutateResumeStoppedWorkRequest = WireInput<ResumeStoppedWorkMutationVariables["input"]>

/** The response of the `resumeStoppedWork` mutation: the typed payload straight from the back end contract. */
type MutateResumeStoppedWorkResponse = ResumeStoppedWorkMutation

type Document = TypedDocumentNode<MutateResumeStoppedWorkResponse, InputVariables<MutateResumeStoppedWorkRequest>>

const mutation1: Document = gql`
    mutation ResumeStoppedWork($input: ResumeStoppedWorkInput!) {
        resumeStoppedWork(input: $input)
    }
`

enum MutationResumeStoppedWork {
    Mutation1 = "mutation1",
}

const mutationMap: Record<MutationResumeStoppedWork, Document> = {
    [MutationResumeStoppedWork.Mutation1]: mutation1,
}

/** Apollo params for {@link mutateResumeStoppedWork}. */
type MutateResumeStoppedWorkParams = MutateParams<MutationResumeStoppedWork, MutateResumeStoppedWorkRequest>

/** Runs a stopped background job again (the back end `resumeStoppedWork` mutation, owner or manager). */
export const mutateResumeStoppedWork = async ({
    mutation = MutationResumeStoppedWork.Mutation1,
    request,
    signal,
}: MutateResumeStoppedWorkParams): Promise<ApolloClient.MutateResult<MutateResumeStoppedWorkResponse>> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.mutate({ mutation: mutationMap[mutation], variables: { input: request } })
}
