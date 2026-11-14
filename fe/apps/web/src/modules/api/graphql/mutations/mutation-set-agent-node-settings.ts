import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type InputVariables, type MutateParams, type WireInput } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type {
    SetAgentNodeSettingsMutation,
    SetAgentNodeSettingsMutationVariables,
} from "../__generated__/graphql"

/** The input of the `setAgentNodeSettings` mutation. */
export type MutateSetAgentNodeSettingsRequest = WireInput<SetAgentNodeSettingsMutationVariables["input"]>

/** The response of the `setAgentNodeSettings` mutation: the typed payload straight from the back end contract. */
type MutateSetAgentNodeSettingsResponse = SetAgentNodeSettingsMutation

type Document = TypedDocumentNode<
    MutateSetAgentNodeSettingsResponse,
    InputVariables<MutateSetAgentNodeSettingsRequest>
>

const mutation1: Document = gql`
    mutation SetAgentNodeSettings($input: SetAgentNodeSettingsInput!) {
        setAgentNodeSettings(input: $input) {
            id
            number
            changeKind
            authorKind
            authorId
            note
            templateId
            templateVersion
            fromNumber
            publishedAt
            stepCount
            changedSteps
            active
        }
    }
`

enum MutationSetAgentNodeSettings {
    Mutation1 = "mutation1",
}

const mutationMap: Record<MutationSetAgentNodeSettings, Document> = {
    [MutationSetAgentNodeSettings.Mutation1]: mutation1,
}

/** Apollo params for {@link mutateSetAgentNodeSettings}. */
type MutateSetAgentNodeSettingsParams = MutateParams<
    MutationSetAgentNodeSettings,
    MutateSetAgentNodeSettingsRequest
>

/** The back end `setAgentNodeSettings` mutation. */
export const mutateSetAgentNodeSettings = async ({
    mutation = MutationSetAgentNodeSettings.Mutation1,
    request,
    signal,
}: MutateSetAgentNodeSettingsParams): Promise<
    ApolloClient.MutateResult<MutateSetAgentNodeSettingsResponse>
> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.mutate({ mutation: mutationMap[mutation], variables: { input: request } })
}
