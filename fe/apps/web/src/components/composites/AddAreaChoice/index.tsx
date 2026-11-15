import { SurfaceCard } from "@starci/grammar/common"
import type { AddAreaView } from "@/modules/types"

/** The words, rows and state of the area choice. */
type AddAreaChoiceProps = AddAreaView & {
    readonly isBusy: boolean
    readonly onArea: (value: string) => void
}

/** The area a batch is added to, chosen by the owner before it is sent: internal (the default) or public, one row checked, each saying who reads the documents. */
export const AddAreaChoice = (props: AddAreaChoiceProps) => (
    <SurfaceCard
        kind="select"
        selectionMode="single"
        sublabel={props.label}
        items={props.items.map((item) => ({ ...item, isDisabled: props.isBusy }))}
        value={props.value}
        onChange={props.onArea}
    />
)
