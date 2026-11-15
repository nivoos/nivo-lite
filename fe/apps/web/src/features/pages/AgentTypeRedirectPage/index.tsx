import { carriedQuery } from "@/hooks/installations"
import type { AgentTab } from "@/modules/installations"
import { AgentTypeRedirectPageBase } from "./component"

/** What the route hands the page: the type of the old url, the tab it named and its query. */
type AgentTypeRedirectPageProps = {
    readonly module: string
    readonly tab: AgentTab
    readonly search: Readonly<Record<string, string | string[] | undefined>>
}

/** The url of a tab before agents became instances: the connected block leads to the only instance, else the list. */
export const AgentTypeRedirectPage = (props: AgentTypeRedirectPageProps) => {
    return (
        <AgentTypeRedirectPageBase
            props={{ module: props.module, tab: props.tab, query: carriedQuery(props.search) }}
        />
    )
}
