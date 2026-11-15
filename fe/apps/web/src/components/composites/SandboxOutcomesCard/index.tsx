import { Select, SurfaceCard, Text, type ListRowData } from "@starci/grammar/common"
import { SANDBOX_OUTCOME_OK } from "@/modules/sandbox"
import type { DataSlot, SandboxCopy, SandboxOutcomeRowView, SandboxOutcomesData, SandboxPendingView } from "@/modules/types"

/** What the outcomes card draws and does. */
interface SandboxOutcomesCardProps {
    readonly copy: SandboxCopy
    readonly slot: DataSlot<SandboxOutcomesData>
    readonly pending: SandboxPendingView
    readonly on: {
        /** Sets the outcome of the next outbound calls of an operation; `ok` takes it back to the default. */
        readonly setOutcome: (operation: string, outcome: string) => void
    }
}

/** What an operation answers now, in words: its outcome, or the case it answers when that case carries no generic outcome. */
const nowLineOf = (row: SandboxOutcomeRowView, copy: SandboxCopy["outcomes"]): string => {
    if (row.current !== null) return copy.nowLine(row.current)
    return row.caseId === null ? "" : copy.nowCaseLine(row.caseId)
}

/** One operation as a row: its name over what it answers now (and that it stays), a picker of the outcomes it offers, and the way back to `ok`. */
const rowOf = (row: SandboxOutcomeRowView, props: SandboxOutcomesCardProps): ListRowData => {
    const isBusy = props.pending.outcomeOperation === row.operation
    const canGoBack = row.current !== SANDBOX_OUTCOME_OK && row.options.includes(SANDBOX_OUTCOME_OK)
    const copy = props.copy.outcomes
    return {
        id: row.operation,
        title: row.operation,
        description: (
            <Text as="span" size="xs" tone="muted">
                {nowLineOf(row, copy)}
            </Text>
        ),
        actionPlacement: "end",
        ...(canGoBack
            ? {
                  action: {
                      label: copy.backLabel,
                      press: () => props.on.setOutcome(row.operation, SANDBOX_OUTCOME_OK),
                      isPending: isBusy,
                  },
              }
            : {}),
        control: (
            <Select
                label={copy.selectLabel(row.operation)}
                isLabelHidden
                appearance="compact"
                placeholder={copy.placeholder}
                isDisabled={isBusy}
                value={row.current}
                onValueChange={(outcome) => {
                    if (outcome !== null && outcome !== row.current) props.on.setOutcome(row.operation, outcome)
                }}
                options={row.options.map((outcome) => ({ id: outcome, label: copy.names[outcome] ?? outcome }))}
            />
        ),
    }
}

/**
 * The outcome of the next outbound calls, per operation: for each operation of the open account that offers a choice, what it answers
 * now and a picker of the outcomes it offers (the generic ones: ok, refused, final, transient, timeout). The pick stays until it is
 * changed, so a run that calls the operation again meets the same outcome; `ok` is the way back. Drawn only when an operation offers a
 * choice; while the cases load or fail the cases card says so.
 */
export const SandboxOutcomesCard = (props: SandboxOutcomesCardProps) => {
    const rows = "items" in props.slot ? props.slot.items.rows : []
    if (rows.length === 0) return null
    return (
        <SurfaceCard
            kind="list"
            label={props.copy.outcomes.title}
            headingLevel={2}
            headers={[
                {
                    kind: "custom",
                    children: (
                        <Text size="xs" tone="muted">
                            {props.copy.outcomes.hint}
                        </Text>
                    ),
                },
            ]}
            items={rows.map((row) => rowOf(row, props))}
            empty={<Text tone="muted">{props.copy.cases.empty}</Text>}
        />
    )
}
