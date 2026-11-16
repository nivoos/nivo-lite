import { Badge, Cluster, Stack, Sublabel, SurfaceCard, Text } from "@starci/grammar/common"
import type { StepAccountChoiceView, StepAccountsPanelView, StepAction } from "@/modules/types"

/** What the accounts section of a step's panel draws and what it does. */
interface StepAccountsProps {
    readonly view: StepAccountsPanelView
    readonly onAction: (action: StepAction) => void
}

/** The ids after a toggle, in the order the step tries them: those it already used keep their place, a newly checked account goes last. */
const orderedIdsOf = (kept: ReadonlyArray<string>, next: ReadonlyArray<string>): ReadonlyArray<string> => [
    ...kept.filter((id) => next.includes(id)),
    ...next.filter((id) => !kept.includes(id)),
]

/** The plain Badges at the end of a row: "Default" for the agent's default account, "Sandbox" for a sandbox account; none for neither. */
const controlOf = (option: StepAccountChoiceView, panel: StepAccountsPanelView) =>
    !option.isDefault && !option.isSandbox ? undefined : (
        <Cluster gap="inline">
            {option.isDefault ? <Badge tone="neutral">{panel.defaultLabel}</Badge> : null}
            {option.isSandbox ? <Badge tone="neutral">{panel.sandboxLabel}</Badge> : null}
        </Cluster>
    )

/**
 * The accounts section of a workflow step's drawer (rights.md): which accounts the step uses, read from what the back end says the step
 * could use. The app's one choice list (a select card, checkbox rows with full-width dividers): the ones the step uses first with their
 * place in the order tried among the accounts of their provider, plain Badges "Default" and "Sandbox", a not working account disabled
 * with its reason in its line, and the one muted 12 line that applies.
 */
export const StepAccounts = (props: StepAccountsProps) => {
    const { view } = props.view
    return (
        <Stack gap="row">
            <Sublabel>{view.sectionTitle}</Sublabel>
            {view.options.length === 0 ? null : (
                <SurfaceCard
                    kind="select"
                    ariaLabel={view.sectionTitle}
                    selectionMode="multiple"
                    value={view.value}
                    onChange={(ids) => props.onAction({ kind: "accounts", ids: orderedIdsOf(view.value, ids) })}
                    items={view.options.map((option) => {
                        const control = controlOf(option, props.view)
                        return {
                            id: option.id,
                            title: option.title,
                            subtitle: option.subtitle,
                            isDisabled: view.isReadOnly || props.view.isPending || option.unavailable !== "",
                            ...(control === undefined ? {} : { control }),
                        }
                    })}
                />
            )}
            <Text size="xs" tone="muted">
                {view.note === "" ? view.sectionHint : view.note}
            </Text>
        </Stack>
    )
}
