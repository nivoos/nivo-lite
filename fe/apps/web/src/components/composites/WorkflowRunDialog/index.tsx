import { AlertDialog, CheckboxGroup, Stack, Text } from "@starci/grammar/common"
import { useState } from "react"
import type { WorkflowRunAsk, WorkflowStopChoice } from "@/hooks/agentWorkflows"
import type { WorkflowRunCopy } from "@/modules/types"

/** What the dialog of the run commands draws and what it does. */
interface WorkflowRunDialogProps {
    readonly props: {
        readonly copy: WorkflowRunCopy
        /** The open question; null while none is. */
        readonly ask: WorkflowRunAsk | null
    }
    readonly on: {
        readonly close: () => void
        readonly confirm: (choice: WorkflowStopChoice) => Promise<void>
    }
}

/** The stop dialog's choices: end the runs in flight too (only when some are), and keep the events that arrive. */
const STOP_END = "end"
const STOP_HOLD = "hold"

/** One open question: its words, and for the stop its two choices. Only the confirm of ending or stopping is red; starting again is the main button. */
interface QuestionProps {
    readonly copy: WorkflowRunCopy
    readonly ask: WorkflowRunAsk
    readonly close: () => void
    readonly confirm: (choice: WorkflowStopChoice) => Promise<void>
}

const Question = (props: QuestionProps) => {
    const { copy, ask } = props
    const { name, run } = ask.workflow
    const [chosen, setChosen] = useState<ReadonlyArray<string>>([])
    const runs = run.runsInFlight
    const choice: WorkflowStopChoice = { endRuns: runs > 0 && chosen.includes(STOP_END), holdEvents: chosen.includes(STOP_HOLD) }
    const words =
        ask.kind === "stop"
            ? { title: copy.stopTitle(name), body: copy.stopBody(runs), confirm: copy.stopConfirm }
            : ask.kind === "end"
              ? { title: copy.endTitle, body: copy.endBody(name, runs), confirm: copy.endConfirm }
              : { title: copy.startTitle(name), body: copy.startBody(run.eventsHeld), confirm: copy.startConfirm }
    return (
        <AlertDialog
            isOpen
            onOpenChange={(isOpen) => (isOpen ? undefined : props.close())}
            title={words.title}
            description={words.body}
            tone={ask.kind === "start" ? "neutral" : "negative"}
            confirmLabel={words.confirm}
            cancelLabel={copy.cancel}
            onConfirm={() => props.confirm(choice)}
            onCancel={props.close}
        >
            {ask.kind === "stop" ? (
                <Stack gap="row">
                    <CheckboxGroup
                        label={copy.stop}
                        isLabelHidden
                        options={[
                            ...(runs > 0 ? [{ value: STOP_END, label: copy.stopEndRuns(runs) }] : []),
                            { value: STOP_HOLD, label: copy.stopHold },
                        ]}
                        value={chosen}
                        onValueChange={setChosen}
                    />
                    <Text size="xs" tone="muted">
                        {copy.stopHoldHelp}
                    </Text>
                </Stack>
            ) : null}
        </AlertDialog>
    )
}

/** The dialog of the stop, start and end-all commands of a workflow: the question, its choices, "Later" and the one confirm. */
export const WorkflowRunDialog = (props: WorkflowRunDialogProps) =>
    props.props.ask === null ? null : (
        <Question
            key={`${props.props.ask.kind}-${props.props.ask.workflow.id}`}
            copy={props.props.copy}
            ask={props.props.ask}
            close={props.on.close}
            confirm={props.on.confirm}
        />
    )
