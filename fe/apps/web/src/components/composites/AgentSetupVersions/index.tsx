import { EmptyNotice, Section, type ListRowData } from "@starci/grammar/common"
import { nivoIconSource } from "@/components/leaves/Icon"
import type { AgentGraphVersionsView, AgentSetupCopy } from "@/modules/types"

/** The versions of the graph (the one source of the running version), the words, (read only). */
interface AgentSetupVersionsProps {
    readonly view: AgentGraphVersionsView
    readonly isLoading: boolean
    readonly copy: AgentSetupCopy
}

/** The row of one version: its name, who and when, the chip of the one in use. */
const rowOf = (props: AgentSetupVersionsProps, version: AgentGraphVersionsView["items"][number]): ListRowData => ({
    id: version.id,
    title: version.title,
    description: [version.byLine, version.note].filter((part) => part !== "").join(" · "),
    ...(version.isActive ? { badges: [{ label: props.copy.inUseLabel, tone: "success", isDot: true }] } : {}),
})

/**
 * "Versions": the title above, then one card that is the list of the saved versions of the agent, newest first. The one in use
 * carries the chip. Read only: a shop never edits a graph, so no version offers a way back.
 */
export const AgentSetupVersions = (props: AgentSetupVersionsProps) => (
    <Section
        kind="list"
        title={props.copy.versionsTitle}
        headingLevel={2}
        isLoading={props.isLoading}
        empty={<EmptyNotice message={props.copy.versionsEmpty} iconSource={nivoIconSource("saved", "leading")} />}
        items={props.view.items.map((version) => rowOf(props, version))}
    />
)
