import { Alert, Badge, Button, Link } from "@starci/grammar/common"
import { SlotView } from "@nivo-lite/agent-sdk/client"
import { AgentRunsListTable } from "@/components/composites/AgentRunsListTable"
import { AgentWorkflowMap } from "@/components/composites/AgentWorkflowMap"
import { AgentWorkflowOverview, type AgentWorkflowOverviewCopy } from "@/components/composites/AgentWorkflowOverview"
import {
    AgentWorkflowVersionTable,
    type AgentWorkflowVersionTableCopy,
} from "@/components/composites/AgentWorkflowVersionTable"
import { PaneHead } from "@/components/composites/PaneHead"
import type {
    DataSlot,
    RunsFilter,
    RunsTableCopy,
    RunsView,
    SlotLabels,
    StepsMapView,
    WorkflowDetailView,
    WorkflowNoticeView,
    WorkflowOverviewView,
    WorkflowRunCopy,
    WorkflowStatus,
} from "@/modules/types"
import type { WorkflowRunAsk, WorkflowRunAskKind } from "@/hooks/agentWorkflows"

/** The tab of the page of a workflow that is open. */
export type DetailTab = "io" | "map" | "versions" | "runs"

/** The words of the parts of the page of a workflow. */
export interface AgentWorkflowDetailCopy {
    readonly paneLabel: string
    /** update from the template: the notice's one command. */
    readonly noticeAction: string
    /** see changes: the link in the notice's text to the page of what the update would change. */
    readonly noticePreview: string
    /** What updating does, under the notice: a new version is made, the owner's edits stay. */
    readonly noticeCaption: string
    readonly mapTitle: string
    readonly graphLabel: string
    readonly graphCaption: string
    readonly graphEmpty: string
    readonly overview: AgentWorkflowOverviewCopy
    readonly versions: AgentWorkflowVersionTableCopy
    readonly runs: RunsTableCopy
    readonly run: WorkflowRunCopy
}

/** What the head of the page needs: the workflow and the commands. */
interface DetailHeadProps {
    readonly view: WorkflowDetailView
    readonly copy: WorkflowRunCopy
    readonly isLoading: boolean
    /** Turns a draft on. */
    readonly onToggle: (status: WorkflowStatus) => void
    /** Opens the dialog of stopping, starting again or ending every run in flight. */
    readonly onAsk: (ask: WorkflowRunAsk) => void
    readonly isWriting: boolean
}

/**
 * The head of the page: name, where it stands (running, stopped) with its line, and the commands: stop or start again, and end all
 * runs in flight while some are. The primary workflow cannot be stopped, so it has no stop; a draft has the one turn-on command.
 */
export const DetailHead = (props: DetailHeadProps) => {
    const { view, copy } = props
    const { head } = view
    const ask = (kind: WorkflowRunAskKind) => () =>
        props.onAsk({ kind, workflow: { id: head.id, name: head.name, run: head.run } })
    const status = head.status === "active" ? copy.statusActive : head.status === "paused" ? copy.statusPaused : head.statusLabel
    const line = copy.line(head.run, true)
    return (
        <PaneHead
            title={head.name}
            headingLevel={1}
            description={line === "" ? head.facts : line}
            status={
                <Badge tone={head.statusTone} isDot>
                    {status}
                </Badge>
            }
            isLoading={props.isLoading}
            actions={
                <>
                    {head.status === "draft" ? (
                        <Button
                            intent="neutral"
                            size="sm"
                            isPending={props.isWriting}
                            isDisabled={props.isLoading}
                            onPress={() => props.onToggle(head.toggleTo)}
                        >
                            {head.toggleLabel}
                        </Button>
                    ) : null}
                    {head.status === "active" && !head.run.isPrimary ? (
                        <Button intent="neutral" size="sm" isDisabled={props.isLoading} onPress={ask("stop")}>
                            {copy.stop}
                        </Button>
                    ) : null}
                    {head.status === "paused" ? (
                        <Button intent="neutral" size="sm" isDisabled={props.isLoading} onPress={ask("start")}>
                            {copy.start}
                        </Button>
                    ) : null}
                    {head.run.runsInFlight > 0 ? (
                        <Button intent="neutral" size="sm" isDisabled={props.isLoading} onPress={ask("end")}>
                            {copy.endAll}
                        </Button>
                    ) : null}
                </>
            }
        />
    )
}

/** What the notice of a newer template version needs. */
interface TemplateNoticeProps {
    readonly notice: WorkflowNoticeView
    readonly copy: AgentWorkflowDetailCopy
    readonly onSync: () => void
    /** The page of what the update would change (the template preview). */
    readonly previewHref: string
}

/**
 * The one neutral notice of a workflow whose template has a newer version: its title and what changed (the API's changelog and
 * step count), and the one command update from the template. Declining is doing nothing: the old version keeps running.
 */
export const TemplateNotice = (props: TemplateNoticeProps) => {
    const { notice, copy } = props
    // A template version that cannot be read has nothing to preview or accept: the notice only says a newer version exists.
    const lines = notice.canUpdate ? [notice.changelog, notice.diffLine, copy.noticeCaption] : [notice.changelog]
    return (
        <Alert
            tone="neutral"
            title={notice.title}
            description={
                <>
                    {lines.filter((line) => line !== "").join(" · ")}
                    {notice.canUpdate ? (
                        <>
                            {" "}
                            <Link href={props.previewHref}>{copy.noticePreview}</Link>
                        </>
                    ) : null}
                </>
            }
            {...(notice.canUpdate ? { action: { label: copy.noticeAction, onAction: props.onSync } } : {})}
        />
    )
}

/** What the open part draws. */
interface DetailPanelProps {
    readonly tab: DetailTab
    readonly copy: AgentWorkflowDetailCopy
    readonly view: WorkflowDetailView
    readonly overview: WorkflowOverviewView
    readonly map: StepsMapView
    readonly selectedStep: string | null
    readonly runs: DataSlot<RunsView>
    readonly runsPlaceholder: RunsView
    readonly runsFilter: RunsFilter
    readonly slotLabels: SlotLabels
    readonly versionBase: string
    readonly isLoading: boolean
    readonly on: {
        readonly pressStep: (nodeKey: string) => void
        readonly rollback: (number: number) => void
        readonly runsFilter: (next: Partial<RunsFilter>) => void
        readonly runsTab: (key: string) => void
        readonly runsRetry: () => void
    }
}

/** What the runs of this workflow need. */
interface RunsPanelProps {
    readonly copy: RunsTableCopy
    readonly slot: DataSlot<RunsView>
    readonly placeholder: RunsView
    readonly filter: RunsFilter
    readonly slotLabels: SlotLabels
    readonly on: {
        readonly filter: (next: Partial<RunsFilter>) => void
        readonly tab: (key: string) => void
        readonly retry: () => void
    }
}

/** The runs of this workflow only, read-only. */
const RunsPanel = (props: RunsPanelProps) => (
    <SlotView
        slot={props.slot}
        placeholder={props.placeholder}
        labels={props.slotLabels}
        onRetry={props.on.retry}
        render={(runs, isLoading) => (
            <AgentRunsListTable
                key={[props.filter.tab, props.filter.query, props.filter.source].join("|")}
                props={{ copy: props.copy, view: runs, filter: props.filter, workflows: null, isLoading }}
                on={{ filter: props.on.filter, tab: props.on.tab }}
            />
        )}
    />
)

/** The open part: the overview, the map, the versions or the runs. */
export const DetailPanel = (props: DetailPanelProps) => {
    const { copy, view, isLoading } = props
    if (props.tab === "io")
        return <AgentWorkflowOverview props={{ copy: copy.overview, view: props.overview, isLoading }} />
    if (props.tab === "versions")
        return (
            <AgentWorkflowVersionTable
                props={{
                    copy: copy.versions,
                    versions: view.versions,
                    hrefOf: (number) => `${props.versionBase}/${number}`,
                    isLoading,
                }}
                on={{ rollback: props.on.rollback }}
            />
        )
    if (props.tab === "runs")
        return (
            <RunsPanel
                copy={copy.runs}
                slot={props.runs}
                placeholder={props.runsPlaceholder}
                filter={props.runsFilter}
                slotLabels={props.slotLabels}
                on={{ filter: props.on.runsFilter, tab: props.on.runsTab, retry: props.on.runsRetry }}
            />
        )
    return (
        <AgentWorkflowMap
            props={{
                title: copy.mapTitle,
                label: copy.graphLabel,
                caption: copy.graphCaption,
                emptyLabel: copy.graphEmpty,
                flow: props.map,
                selectedId: props.selectedStep,
                isLoading,
            }}
            on={{ pressStep: props.on.pressStep }}
        />
    )
}
