import {
    Badge,
    Button,
    Cluster,
    DataTable,
    EmptyNotice,
    Section,
    Stack,
    Text,
    type DataTableColumn,
    type DataTableRow,
} from "@starci/grammar/common"
import { nivoIconSource } from "@/components/leaves/Icon"
import type { WorkflowRunAsk } from "@/hooks/agentWorkflows"
import type { WorkflowRunCopy, WorkflowTableRowView } from "@/modules/types"

/** The words of the table of workflows. */
export interface AgentWorkflowTableCopy {
    readonly title: string
    readonly name: string
    readonly start: string
    readonly end: string
    readonly entry: string
    readonly version: string
    readonly runs: string
    readonly status: string
    readonly none: string
    readonly empty: string
    readonly emptyBody: string
    readonly caption: string
    readonly run: WorkflowRunCopy
}

/** What the table draws: a row opens its workflow. The command that creates a workflow is the head of the pane, not of the section. */
interface AgentWorkflowTableProps {
    readonly props: {
        readonly copy: AgentWorkflowTableCopy
        readonly rows: ReadonlyArray<WorkflowTableRowView>
        readonly isLoading: boolean
    }
    /** Opens the dialog of stopping or starting a workflow again. */
    readonly on: { readonly ask: (ask: WorkflowRunAsk) => void }
}

/** One row of the table: a workflow, opened by pressing the row. */
interface WorkflowRow extends DataTableRow {
    readonly workflow: WorkflowTableRowView
}

/** Chips of a cell, or the muted word when the read carries none. */
const chipsOf = (labels: ReadonlyArray<string>, none: string) =>
    labels.length === 0 ? (
        <Text tone="muted">{none}</Text>
    ) : (
        <Cluster gap="row">
            {labels.map((label) => (
                <Badge key={label} tone="neutral">
                    {label}
                </Badge>
            ))}
        </Cluster>
    )

/** What one cell of a row draws: the name with its origin, the chips, the version, the runs or the state. */
const cellOf = (
    workflow: WorkflowTableRowView,
    columnId: string,
    copy: AgentWorkflowTableCopy,
    onAsk: (ask: WorkflowRunAsk) => void,
) => {
    const none = copy.none
    if (columnId === "name") {
        const line = copy.run.line(workflow.run, false)
        return (
            <Stack gap="identity">
                <Text>{workflow.name}</Text>
                <Text size="xs" tone="muted">
                    {workflow.provenance}
                </Text>
                {line === "" ? null : (
                    <Text size="xs" tone="muted">
                        {line}
                    </Text>
                )}
            </Stack>
        )
    }
    if (columnId === "actions") {
        const { run } = workflow
        const kind = run.status === "paused" ? "start" : run.status === "active" && !run.isPrimary ? "stop" : null
        return kind === null ? null : (
            <Button
                intent="neutral"
                size="sm"
                onPress={() => onAsk({ kind, workflow: { id: workflow.id, name: workflow.name, run } })}
            >
                {kind === "stop" ? copy.run.rowStop : copy.run.rowStart}
            </Button>
        )
    }
    if (columnId === "start") return chipsOf(workflow.starts, none)
    if (columnId === "end") return chipsOf(workflow.ends, none)
    if (columnId === "entry") return <Text tone="muted">{workflow.entry === "" ? none : workflow.entry}</Text>
    if (columnId === "version") return <Text tone="muted">{workflow.versionLabel}</Text>
    if (columnId === "runs") return <Text tone="muted">{workflow.runs7d === null ? "-" : String(workflow.runs7d)}</Text>
    return (
        <Badge tone={workflow.statusTone} isDot>
            {workflow.run.status === "active"
                ? copy.run.statusActive
                : workflow.run.status === "paused"
                  ? copy.run.statusPaused
                  : workflow.statusLabel}
        </Badge>
    )
}

/** The workflows of the agent as one table under a Section head with the count; a row opens the workflow. */
export const AgentWorkflowTable = (props: AgentWorkflowTableProps) => {
    const { copy, rows } = props.props
    const columns: ReadonlyArray<DataTableColumn<WorkflowRow>> = [
        { id: "name", label: copy.name, isRowHeader: true },
        { id: "start", label: copy.start, hideBelow: "tablet" },
        { id: "end", label: copy.end, hideBelow: "desktop" },
        { id: "entry", label: copy.entry, hideBelow: "desktop" },
        { id: "version", label: copy.version, width: "fit" },
        { id: "runs", label: copy.runs, isNumeric: true, hideBelow: "tablet" },
        { id: "status", label: copy.status, width: "fit" },
        { id: "actions", label: copy.run.rowActions, width: "fit", isLabelHidden: true },
    ]
    const data: ReadonlyArray<WorkflowRow> = rows.map((workflow) => ({
        id: workflow.id,
        href: workflow.href,
        workflow,
    }))
    return (
        <Section
            title={copy.title}
            headingLevel={2}
            count={rows.length}
            caption={copy.caption}
            isLoading={props.props.isLoading}
        >
            <DataTable
                label={copy.title}
                columns={columns}
                rows={data}
                renderCell={(row, columnId) => cellOf(row.workflow, columnId, copy, props.on.ask)}
                isLoading={props.props.isLoading}
                emptyContent={
                    <EmptyNotice
                        message={copy.empty}
                        description={copy.emptyBody}
                        iconSource={nivoIconSource("overview", "leading")}
                    />
                }
            />
        </Section>
    )
}
