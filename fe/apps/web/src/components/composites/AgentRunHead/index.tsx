import { Badge, Button, Cluster, DropdownMenu, Heading, Stack, Text } from "@starci/grammar/common"
import { RunDoorActions } from "@/components/composites/RunDoorActions"
import { AgentRunStatusMark } from "@/components/leaves/Icon"
import type { RunHeadView, RunSwitchView } from "@/modules/types"

/** The words of the head card of a run. */
export interface AgentRunHeadCopy {
    readonly ariaLabel: string
    readonly switchLabel: string
}

/** What the head card draws and what it does. */
interface AgentRunHeadProps {
    readonly props: {
        readonly copy: AgentRunHeadCopy
        readonly head: RunHeadView
        readonly switches: ReadonlyArray<RunSwitchView>
        readonly isLoading: boolean
    }
    readonly on: {
        /** A command on the run was answered: the page reads the run again. */
        readonly done: () => void
    }
}

/**
 * The head of a run, on the well and in no card: its title and id, where it stands (an outline mark and the word), the line of when and
 * on what it ran, the quick switch to the runs that are running now, and the neutral commands on a run in flight: Pause or Resume and
 * End run (each end and pause behind its dialog). A live status (running, paused) is a Badge with a dot; any other is the outline mark.
 */
export const AgentRunHead = (props: AgentRunHeadProps) => {
    const { copy, head, switches } = props.props
    return (
        <Stack gap="inline">
            <Cluster gap="identity" justify="between">
                <Stack gap="identity">
                    <Cluster gap="inline">
                        <Heading level={2}>{head.title}</Heading>
                        <Text tone="muted">{`#${head.shortId}`}</Text>
                        {head.status === "running" || head.status === "paused" ? (
                            <Badge isDot tone={head.statusTone}>
                                {head.statusLabel}
                            </Badge>
                        ) : (
                            <Cluster gap="identity" wrap={false}>
                                <AgentRunStatusMark props={{ status: head.status, label: head.statusLabel }} />
                                <Text>{head.statusLabel}</Text>
                            </Cluster>
                        )}
                    </Cluster>
                    <Text size="xs" tone="muted">
                        {head.meta}
                    </Text>
                </Stack>
                <Cluster gap="inline">
                    {switches.length === 0 ? null : (
                        <DropdownMenu
                            placement="bottom end"
                            entries={switches.map((entry) => ({ id: entry.id, label: entry.label, href: entry.href }))}
                            trigger={<Button intent="neutral">{copy.switchLabel}</Button>}
                        />
                    )}
                    <RunDoorActions
                        runId={head.id}
                        canPause={head.canPause}
                        canResume={head.canResume}
                        canCancel={head.canCancel}
                        hasCustomer={head.hasCustomer}
                        subtitle={head.workflowName}
                        onDone={props.on.done}
                    />
                </Cluster>
            </Cluster>
        </Stack>
    )
}
