import { AlertDialog, Badge, Button, DropdownMenu, IconButton } from "@starci/grammar/common"
import { KnowledgeDocMark } from "@/components/composites/KnowledgeDocMark"
import { PaneHead } from "@/components/composites/PaneHead"
import { nivoIconSource } from "@/components/leaves/Icon"
import type { DocHeadView } from "@/modules/types"
import { WIDE_ONLY_CLASS_NAME } from "./classNames"

/** What the head band of an opened document draws and calls. */
interface KnowledgeDocHeadProps {
    readonly head: DocHeadView
    readonly backLabel: string
    readonly moreLabel: string
    /** The name of the control that opens the details on a phone; null where the screen has no details pane. */
    readonly detailsLabel: string | null
    readonly isLoading: boolean
    readonly isRemoveOpen: boolean
    readonly isAreaOpen: boolean
    readonly onBack: () => void
    readonly onReindex: () => void
    readonly onMenu: (id: string) => void
    readonly onRemoveOpenChange: (isOpen: boolean) => void
    readonly onRemove: () => Promise<void>
    /** Opens or closes the question asked before the document moves to the other area. */
    readonly onAreaOpenChange: (isOpen: boolean) => void
    readonly onArea: () => Promise<void>
}

/** What the "..." menu of the head draws and calls. */
interface HeadMenuProps {
    readonly head: DocHeadView
    readonly moreLabel: string
    readonly onMenu: (id: string) => void
}

/** The "..." menu of the head: the commands behind it; none, no menu. */
const HeadMenu = (props: HeadMenuProps) =>
    props.head.menu.length === 0 ? null : (
        <DropdownMenu
            placement="bottom end"
            entries={props.head.menu.map((item) => ({
                id: item.id,
                label: item.label,
                ...(item.tone === undefined ? {} : { tone: item.tone }),
                onAction: () => props.onMenu(item.id),
            }))}
            trigger={<IconButton intent="neutral" source={nivoIconSource("more", "leading")} label={props.moreLabel} />}
        />
    )

/** What the area button draws and calls. */
interface AreaButtonProps {
    readonly head: DocHeadView
    readonly onOpen: () => void
}

/** The button that opens the question of moving the document to the other area; none where the area cannot be changed. */
const AreaButton = (props: AreaButtonProps) =>
    props.head.area === null ? null : (
        <div className={WIDE_ONLY_CLASS_NAME}>
            <Button intent="neutral" size="sm" isPending={props.head.area.isPending} onPress={props.onOpen}>
                {props.head.area.label}
            </Button>
        </div>
    )

/** What the question before an area change draws and calls. */
interface AreaDialogProps {
    readonly head: DocHeadView
    readonly isOpen: boolean
    readonly onOpenChange: (isOpen: boolean) => void
    readonly onConfirm: () => Promise<void>
}

/** The question asked before the document moves to the other area; moving to public says plainly that customers may be told its content. */
const AreaDialog = (props: AreaDialogProps) =>
    props.head.area === null ? null : (
        <AlertDialog
            isOpen={props.isOpen}
            onOpenChange={props.onOpenChange}
            tone="informative"
            title={props.head.area.confirm.title}
            description={props.head.area.confirm.description}
            confirmLabel={props.head.area.confirm.confirmLabel}
            cancelLabel={props.head.area.confirm.cancelLabel}
            isConfirmPending={props.head.area.isPending}
            onConfirm={props.onConfirm}
        />
    )

/**
 * The head band over the opened document: its mark, name with where it stands and who may read it, one line of when and what, and
 * its commands: "read again" as the one neutral button and a "..." menu for the rest, where deleting asks to be confirmed. The base
 * knowledge has neither command, so its band is only the title and its "read only" chip.
 */
export const KnowledgeDocHead = (props: KnowledgeDocHeadProps) => {
    const { head } = props
    /** A pane head holds ONE status chip beside the title (two chips squeeze a long title to a few letters): the state stays a chip, the rest say themselves in the line under the title. */
    const [first] = head.chips
    return (
        <>
            <PaneHead
                title={head.title}
                headingLevel={1}
                description={[...head.chips.slice(1).map((chip) => chip.label), head.meta]
                    .filter((part) => part !== "")
                    .join(" · ")}
                mark={<KnowledgeDocMark glyph={head.glyph} />}
                status={
                    first === undefined ? undefined : (
                        <div className={WIDE_ONLY_CLASS_NAME}>
                            <Badge tone={first.tone}>{first.label}</Badge>
                        </div>
                    )
                }
                {...(props.detailsLabel === null
                    ? {}
                    : {
                          drawerOpener: {
                              pane: "aside",
                              icon: nivoIconSource("info", "leading"),
                              label: props.detailsLabel,
                          },
                      })}
                back={{ label: props.backLabel, onPress: props.onBack }}
                isLoading={props.isLoading}
                actions={
                    <>
                        {head.reindex === null ? null : (
                            <div className={WIDE_ONLY_CLASS_NAME}>
                                <Button
                                    intent="neutral"
                                    size="sm"
                                    isPending={head.reindex.isPending}
                                    isDisabled={head.reindex.isDisabled}
                                    onPress={props.onReindex}
                                >
                                    {head.reindex.label}
                                </Button>
                            </div>
                        )}
                        <AreaButton head={head} onOpen={() => props.onAreaOpenChange(true)} />
                        <HeadMenu head={head} moreLabel={props.moreLabel} onMenu={props.onMenu} />
                    </>
                }
            />
            <AreaDialog
                head={head}
                isOpen={props.isAreaOpen}
                onOpenChange={props.onAreaOpenChange}
                onConfirm={props.onArea}
            />
            {head.remove === null ? null : (
                <AlertDialog
                    isOpen={props.isRemoveOpen}
                    onOpenChange={props.onRemoveOpenChange}
                    title={head.remove.title}
                    description={head.remove.description}
                    confirmLabel={head.remove.confirmLabel}
                    cancelLabel={head.remove.cancelLabel}
                    isConfirmPending={head.remove.isPending}
                    onConfirm={props.onRemove}
                />
            )}
        </>
    )
}
