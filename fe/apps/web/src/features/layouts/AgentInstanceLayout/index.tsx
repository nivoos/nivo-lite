import type { ReactNode } from "react"
import { AgentInstanceLayoutBase } from "./component"

/** What the route hands the layout: the type and the instance of the url and the routed tab. */
type AgentInstanceLayoutProps = {
    readonly module: string
    readonly installationId: string
    readonly children?: ReactNode
}

/** The frame of every agent instance page: the connected frame reads the installed agents in the browser, the routed tab sits inside it. */
export const AgentInstanceLayout = (props: AgentInstanceLayoutProps) => {
    return (
        <AgentInstanceLayoutBase props={{ module: props.module, installationId: props.installationId }}>
            {props.children}
        </AgentInstanceLayoutBase>
    )
}
