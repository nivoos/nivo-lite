"use client"

import { useTranslations } from "next-intl"
import { useState } from "react"
import { AlertDialog, Button, Checkbox, Stack, Text } from "@starci/grammar/common"
import { useRunDoor } from "@/hooks/agentRuns/useRunDoor"

/** The dialog of one command on a run: where it opens, what names the run, and what it does. */
interface RunDialogProps {
    readonly isOpen: boolean
    readonly onOpenChange: (isOpen: boolean) => void
    /** The muted line under the title: "workflow · customer"; nothing when neither is known. */
    readonly subtitle?: string | undefined
    readonly isPending: boolean
}

/** The end dialog also says whether the run serves a customer (then it may tell the customer) and takes the choice with the confirm. */
interface RunEndDialogProps extends RunDialogProps {
    readonly hasCustomer: boolean
    readonly onConfirm: (tellCustomer: boolean) => void | Promise<unknown>
}

/**
 * The question that ends a run: what stops, an optional "Tell the customer one line" (only when the run serves a customer; off by
 * default) and the dialog's one red, "End". "Later" closes it.
 */
export const RunEndDialog = (props: RunEndDialogProps) => {
    const t = useTranslations("runDoor")
    const [tell, setTell] = useState(false)
    return (
        <AlertDialog
            isOpen={props.isOpen}
            onOpenChange={(open) => {
                if (!open) setTell(false)
                props.onOpenChange(open)
            }}
            tone="negative"
            title={t("endTitle")}
            confirmLabel={t("endConfirm")}
            cancelLabel={t("later")}
            isConfirmPending={props.isPending}
            onConfirm={() => props.onConfirm(props.hasCustomer && tell)}
        >
            <Stack gap="row">
                {props.subtitle === undefined || props.subtitle === "" ? null : (
                    <Text size="xs" tone="muted">
                        {props.subtitle}
                    </Text>
                )}
                <Text>{t("endBody")}</Text>
                {props.hasCustomer ? (
                    <Checkbox
                        label={t("endTell")}
                        description={t("endTellHelp")}
                        isSelected={tell}
                        onSelectedChange={setTell}
                    />
                ) : null}
            </Stack>
        </AlertDialog>
    )
}

/** The pause dialog asks only to confirm. */
interface RunPauseDialogProps extends RunDialogProps {
    readonly onConfirm: () => void | Promise<unknown>
}

/** The question that pauses a run: what happens to the customer's new messages and the timers, and the dialog's one red, "Pause". */
export const RunPauseDialog = (props: RunPauseDialogProps) => {
    const t = useTranslations("runDoor")
    return (
        <AlertDialog
            isOpen={props.isOpen}
            onOpenChange={props.onOpenChange}
            tone="negative"
            title={t("pauseTitle")}
            confirmLabel={t("pauseConfirm")}
            cancelLabel={t("later")}
            isConfirmPending={props.isPending}
            onConfirm={props.onConfirm}
        >
            <Stack gap="row">
                {props.subtitle === undefined || props.subtitle === "" ? null : (
                    <Text size="xs" tone="muted">
                        {props.subtitle}
                    </Text>
                )}
                <Text>{t("pauseBody")}</Text>
            </Stack>
        </AlertDialog>
    )
}

/** What the commands of one run need: the run, which of them it allows now, and where its data is read again. */
interface RunDoorActionsProps {
    readonly runId: string
    readonly canPause: boolean
    readonly canResume: boolean
    readonly canCancel: boolean
    /** The run serves a customer conversation: the end dialog offers to tell the customer. */
    readonly hasCustomer: boolean
    readonly subtitle?: string | undefined
    /** "neutral" on the page and on rows; "dismiss" for the quiet secondary controls of a card. */
    readonly intent?: "neutral" | "dismiss"
    /** The word of the end button: "Kết thúc lần chạy" (default) or the short "Kết thúc" on a row. */
    readonly endLabel?: string | undefined
    readonly onDone: () => void
}

/**
 * The commands on one run in flight, as small text buttons: "Pause" or "Resume" (what the run allows) and "End run", each end and pause
 * behind its dialog; resume needs none. Draws only the buttons the run allows (nothing once it ended) and the dialogs; put it in the
 * Cluster of the place.
 */
export const RunDoorActions = (props: RunDoorActionsProps) => {
    const t = useTranslations("runDoor")
    const door = useRunDoor(props.onDone)
    const [dialog, setDialog] = useState<"end" | "pause" | null>(null)
    const intent = props.intent ?? "neutral"
    const close = (open: boolean): void => {
        if (!open) setDialog(null)
    }
    return (
        <>
            {props.canPause ? (
                <Button intent={intent} size="sm" isDisabled={door.isPausing} onPress={() => setDialog("pause")}>
                    {t("pause")}
                </Button>
            ) : null}
            {props.canResume ? (
                <Button
                    intent={intent}
                    size="sm"
                    isPending={door.isResuming}
                    onPress={() => void door.resume(props.runId)}
                >
                    {t("resume")}
                </Button>
            ) : null}
            {props.canCancel ? (
                <Button intent={intent} size="sm" isDisabled={door.isEnding} onPress={() => setDialog("end")}>
                    {props.endLabel ?? t("endRun")}
                </Button>
            ) : null}
            <RunPauseDialog
                isOpen={dialog === "pause"}
                onOpenChange={close}
                subtitle={props.subtitle}
                isPending={door.isPausing}
                onConfirm={() => door.pause(props.runId)}
            />
            <RunEndDialog
                isOpen={dialog === "end"}
                onOpenChange={close}
                subtitle={props.subtitle}
                hasCustomer={props.hasCustomer}
                isPending={door.isEnding}
                onConfirm={(tellCustomer) => door.end(props.runId, tellCustomer)}
            />
        </>
    )
}
