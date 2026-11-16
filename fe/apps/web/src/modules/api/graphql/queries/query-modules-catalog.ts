import { gql, type ApolloClient, type TypedDocumentNode } from "@apollo/client"
import { createAuthApolloClient, type QueryParams } from "@nivo-lite/api"
import { webApiTransport } from "@/modules/api-transport"
import type { ModulesCatalogQuery, ModulesCatalogQueryVariables } from "../__generated__/graphql"

const query1: TypedDocumentNode<ModulesCatalogQuery, ModulesCatalogQueryVariables> = gql`
    query ModulesCatalog($workspaceId: ID) {
        modulesCatalog(workspaceId: $workspaceId) {
            categories {
                key
                label {
                    vi
                    en
                }
            }
            modules {
                key
                plugin {
                    key
                    label {
                        vi
                        en
                    }
                }
                order
                icon
                glyph
                mascot
                category
                status
                audience
                includedWithWorkspace
                available
                knowledgeFolder
                knowledgeIdeas {
                    key
                    topic {
                        vi
                        en
                    }
                    hint {
                        vi
                        en
                    }
                    businessTypes
                    general
                }
                workbench
                settingsExtras
                requires {
                    capabilities
                    connections
                }
                connectionProviders
                defaultOperatingMode
                multiInstance
                name {
                    vi
                    en
                }
                shortName {
                    vi
                    en
                }
                description {
                    vi
                    en
                }
                points {
                    vi
                    en
                }
                gates {
                    key
                    label_vi
                    label_en
                    hint_vi
                    hint_en
                    writes {
                        kind
                        subjectType
                        attributeLabel
                        scope
                        action
                        field
                    }
                }
            }
        }
    }
`

enum QueryModulesCatalog {
    Query1 = "query1",
}

const queryMap: Record<QueryModulesCatalog, TypedDocumentNode<ModulesCatalogQuery, ModulesCatalogQueryVariables>> = {
    [QueryModulesCatalog.Query1]: query1,
}

/** What the catalogue read is asked: the workspace it is read for, on top of the common query parameters. */
type QueryModulesCatalogParams = QueryParams<QueryModulesCatalog> & { readonly workspaceId: string }

/**
 * Reads the catalogue the back end serves to ONE workspace: the modules of the public plugins and of the private plugins open to that
 * workspace's enterprise, with their copy in both product languages. The workspace is part of the question: without it the back end
 * answers the public plugins only.
 */
export const queryModulesCatalog = async ({
    query = QueryModulesCatalog.Query1,
    signal,
    workspaceId,
}: QueryModulesCatalogParams): Promise<
    ApolloClient.QueryResult<ModulesCatalogQuery>
> => {
    const apollo = createAuthApolloClient(webApiTransport, { signal })
    return apollo.query({ query: queryMap[query], variables: { workspaceId } })
}
