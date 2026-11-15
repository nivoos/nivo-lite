import type { ReactElement } from "react"
import { AgentWorkflowVersionPage } from "@/features/pages/AgentWorkflowVersionPage"

/** The document title of the page of one version of a workflow. */
export { agentWorkflowVersionMetadata as generateMetadata } from "@/features/pages/AgentWorkflowVersionPage"

type PageProps = { readonly params: Promise<{ module: string; installation: string; workflowKey: string; version: string }> }

/** One version of a workflow against the one before it: its own route, opened from a row of the versions part. */
const Page = async (props: PageProps): Promise<ReactElement> => {
    const { installation, workflowKey, version } = await props.params
    return (
        <AgentWorkflowVersionPage installationId={installation} workflowKey={workflowKey} version={version} />
    )
}

export default Page
