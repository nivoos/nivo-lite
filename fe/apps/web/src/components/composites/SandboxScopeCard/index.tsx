import { SurfaceCard } from "@starci/grammar/common"
import type { SandboxCopy, SandboxScopeView } from "@/modules/types"

/** What the scope card draws and does. */
interface SandboxScopeCardProps {
    readonly copy: SandboxCopy
    readonly scope: SandboxScopeView
    readonly onChoose: (scopeId: string) => void
}

/**
 * The width a next case applies to on the model account, as the app's one choice list (a select card, single): every call of the
 * workspace, or one purpose seen in the call log. A purpose is worded; the key only stands under a generic word, as its hint.
 */
export const SandboxScopeCard = (props: SandboxScopeCardProps) => (
    <SurfaceCard
        kind="select"
        sublabel={props.copy.scope.title}
        selectionMode="single"
        value={props.scope.selectedId}
        onChange={props.onChoose}
        items={props.scope.choices.map((choice) => ({
            id: choice.id,
            title: choice.label,
            ...(choice.hint === null ? {} : { subtitle: choice.hint }),
        }))}
    />
)
