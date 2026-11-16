import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type QueryParams } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type { SandboxPayLinkQuery, SandboxPayLinkQueryVariables } from "../__generated__/graphql"

/** The response of the `sandboxPayLink` query: the typed payload straight from the back end contract. */
type QuerySandboxPayLinkResponse = SandboxPayLinkQuery

type Document = TypedDocumentNode<QuerySandboxPayLinkResponse, SandboxPayLinkQueryVariables>

const query1: Document = gql`
    query SandboxPayLink($linkId: String!) {
        sandboxPayLink(linkId: $linkId) {
            linkId
            account {
                id
                provider
                label
            }
            amountVnd
            content
            orderCode
            status
            amountReceivedVnd
            caseIds
            inputs {
                name
                value
            }
        }
    }
`

enum QuerySandboxPayLink {
    Query1 = "query1",
}

const queryMap: Record<QuerySandboxPayLink, Document> = { [QuerySandboxPayLink.Query1]: query1 }

type QuerySandboxPayLinkParams = QueryParams<QuerySandboxPayLink, SandboxPayLinkQueryVariables> & {
    request: SandboxPayLinkQueryVariables
}

/**
 * Reads one pay link the sandbox of a provider handed out (owner and manager, dev switch): its account, amount, content, order code,
 * state, the inbound cases that apply and the inputs the link gives them. Refuses with a typed code for an unknown link, a live
 * account or a switch that is off.
 */
export const querySandboxPayLink = async ({
    query = QuerySandboxPayLink.Query1,
    request,
    signal,
}: QuerySandboxPayLinkParams): Promise<ApolloClient.QueryResult<QuerySandboxPayLinkResponse>> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.query({
        query: queryMap[query],
        variables: request,
        fetchPolicy: "no-cache",
    })
}
