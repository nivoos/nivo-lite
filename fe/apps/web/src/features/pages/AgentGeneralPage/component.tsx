import { Pane, PaneGrid, PaneSection } from "@starci/grammar/common"
import { AgentGeneralForm } from "@/components/blocks/AgentGeneralForm"
import { AgentIdentityCard } from "@/components/blocks/AgentIdentityCard"
import { AgentActivityCard } from "@/components/blocks/AgentActivityCard"
import { AgentProfileOwner } from "@/components/blocks/AgentProfileOwner"
import { AgentRemoveCard } from "@/components/blocks/AgentRemoveCard"

/** The facts of the type and the instance the cards of the section read; undefined on the loading route, whose cards read the address. */
export interface AgentGeneralPageBaseProps {
    readonly props: {
        readonly module: string | undefined
        readonly installationId: string | undefined
        /** The heading of the card that groups the work switch and the reply switch. */
        readonly activityTitle: string
    }
}

/**
 * Draws the "Chung" section of Setup as separate cards under sublabels: the picture, the form (details, working hours calendar, reply
 * limits of a chatbot) with its one footer, then who answers for the agent, its activity and its removal.
 */
export const AgentGeneralPageBase = (props: AgentGeneralPageBaseProps) => {
    const { module, installationId, activityTitle } = props.props
    return (
        <PaneGrid label={activityTitle} areas={{ base: ["main"] }} columns={{ base: ["fill"] }}>
            <Pane area="main" scroll content="cards" label={activityTitle}>
                <PaneSection gap="section">
                    <AgentIdentityCard installationId={installationId} module={module} />
                    <AgentGeneralForm installationId={installationId} module={module} />
                    <AgentProfileOwner installationId={installationId} />
                    <AgentActivityCard installationId={installationId} module={module} />
                    <AgentRemoveCard installationId={installationId} module={module} />
                </PaneSection>
            </Pane>
        </PaneGrid>
    )
}
