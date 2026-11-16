import { Drawer, Stack, SurfaceCard, Sublabel, Text } from "@starci/grammar/common"
import type { StepAction, StepDrawerView, StepFactSectionView } from "@/modules/types"
import { StepAccounts } from "./StepAccounts"
import { StepFactSection } from "./StepFacts"

/** What the drawer of a step draws and what it does. */
interface WorkflowStepDrawerProps {
    readonly view: StepDrawerView
    readonly onAction: (action: StepAction) => void
}

/** What one fact section of the drawer is looked up by. */
interface SectionAtProps {
    readonly view: StepDrawerView
    readonly id: string
}

/** The section of one fact, or nothing when the step has none of it. */
const SectionAt = (props: SectionAtProps) => {
    const section: StepFactSectionView | undefined = props.view.sections.find((one) => one.id === props.id)
    return section === undefined ? null : <StepFactSection section={section} />
}

/**
 * How a node step runs: a choice of two (runs on its own / asks first), each row with the muted line of what it does. Only the owner
 * changes it, and each change writes the next version at once; anybody else reads the mode as words. The line under the block says runs
 * in progress keep the old setting. Nothing here is a primary action.
 */
const StepRunMode = (props: WorkflowStepDrawerProps) => {
    const mode = props.view.runMode
    if (mode === null) return null
    const current = mode.options.find((option) => option.id === mode.value)
    return (
        <Stack gap="row">
            {mode.isEditable ? (
                <SurfaceCard
                    kind="select"
                    sublabel={mode.title}
                    selectionMode="single"
                    value={mode.value}
                    onChange={(value) => {
                        if (value === "auto" || value === "ask") props.onAction({ kind: "node-mode", mode: value })
                    }}
                    items={mode.options.map((option) => ({
                        id: option.id,
                        title: option.label,
                        subtitle: option.description,
                        isDisabled: mode.isPending,
                    }))}
                />
            ) : (
                <>
                    <Sublabel>{mode.title}</Sublabel>
                    <SurfaceCard
                        kind="details"
                        ariaLabel={mode.title}
                        items={[
                            {
                                id: "mode",
                                term: current?.label ?? mode.value,
                                description: current?.description ?? "",
                            },
                        ]}
                    />
                    {mode.ownerNote === "" ? null : (
                        <Text size="sm" tone="muted">
                            {mode.ownerNote}
                        </Text>
                    )}
                </>
            )}
            <Text size="sm" tone="muted">
                {mode.keepNote}
            </Text>
        </Stack>
    )
}

/**
 * The drawer of one step, on the right. A workflow's graph is exactly its template's, so every fact is READ ONLY and explained in words
 * (what the step does, when it runs, what goes in and comes out, the accounts and tools it uses, where it goes next, the workflow a
 * hand-off calls). Only two things are the shop's to set: which attached accounts the step uses and how it runs (`auto | ask`). A run's
 * drawer is read only throughout.
 */
export const WorkflowStepDrawer = (props: WorkflowStepDrawerProps) => {
    const { view } = props
    return (
        <Drawer
            isOpen={view.isOpen}
            onOpenChange={(isOpen) => {
                if (!isOpen) props.onAction({ kind: "close" })
            }}
            title={view.title}
            description={view.description}
            closeLabel={view.closeLabel}
        >
            <Stack gap="row">
                {view.isReadOnly ? (
                    <Text size="xs" tone="muted">
                        {view.readOnlyNote}
                    </Text>
                ) : null}
                <SectionAt view={view} id="what" />
                <SectionAt view={view} id="when" />
                <SectionAt view={view} id="inputs" />
                <SectionAt view={view} id="outputs" />
                {view.accounts === undefined ? null : <StepAccounts view={view.accounts} onAction={props.onAction} />}
                <SectionAt view={view} id="tools" />
                <StepRunMode {...props} />
                <SectionAt view={view} id="exits" />
                <SectionAt view={view} id="call" />
            </Stack>
        </Drawer>
    )
}
