import { Field, ObjectType } from "@nestjs/graphql"
import { AgentWorkflowDiffType } from "./agent-workflow-diff.type"
import { AgentWorkflowNodeSettingsType } from "./agent-workflow-node-settings.type"
import { AgentWorkflowType } from "./agent-workflow.type"
import { AgentWorkflowVersionType } from "./agent-workflow-version.type"

@ObjectType()
/** One workflow with the graph that runs, its history and how it differs from its template. */
export class AgentWorkflowDetailType {
    /** The workflow. */
    @Field(() => AgentWorkflowType)
    workflow!: AgentWorkflowType

    /** The graph of the version that runs, as JSON text. */
    @Field(() => String)
    graphJson!: string

    /** The history, newest first. */
    @Field(() => [AgentWorkflowVersionType])
    versions!: ReadonlyArray<AgentWorkflowVersionType>

    /** How the graph differs from its template version, or null for one made from scratch. */
    @Field(() => AgentWorkflowDiffType, { nullable: true })
    templateDiff!: AgentWorkflowDiffType | null

    /** Every step of the running graph with its node settings (what is settable, what is in force, the accounts it could use). */
    @Field(() => [AgentWorkflowNodeSettingsType])
    nodeSettings!: ReadonlyArray<AgentWorkflowNodeSettingsType>
}
