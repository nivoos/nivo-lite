import { useState } from "react"
import { Badge, Button, Cluster, Input, MessageCard, Stack, SurfaceCard, Text, TextAction } from "@starci/grammar/common"
import { ChatPartyMark } from "@/components/branches/ChatPartyMark"
import type { TeamChatJobParkedHandlers, TeamChatJobParkedView } from "@/modules/types"

/** One "job stopped" card of the NIVO room and what may be done with it. */
interface TeamChatJobParkedCardProps {
    readonly card: TeamChatJobParkedView
    /** What is done with the card; a thread that has none draws it as a notice. */
    readonly jobs: TeamChatJobParkedHandlers | undefined
}

/** What the close form draws and does. */
interface CloseFormProps {
    readonly card: TeamChatJobParkedView
    readonly isPending: boolean
    readonly onSubmit: (reason: string) => void
    readonly onCancel: () => void
}

/** The close form: the reason a person gives, one neutral small button to close and one to leave. */
const CloseForm = (props: CloseFormProps) => {
    const [reason, setReason] = useState("")
    const { labels } = props.card
    return (
        <Stack gap="row">
            <Input
                id={`job-parked-reason-${props.card.jobId}`}
                name="reason"
                label={labels.closeReasonLabel}
                size="sm"
                value={reason}
                isDisabled={props.isPending}
                onValueChange={setReason}
            />
            <Cluster gap="inline">
                <Button
                    intent="neutral"
                    size="sm"
                    isPending={props.isPending}
                    isDisabled={reason.trim() === ""}
                    onPress={() => props.onSubmit(reason.trim())}
                >
                    {labels.closeSubmit}
                </Button>
                <Button intent="neutral" size="sm" isDisabled={props.isPending} onPress={props.onCancel}>
                    {labels.cancel}
                </Button>
            </Cluster>
        </Stack>
    )
}

/**
 * The card NIVO posts when a background job stopped for a fix, drawn by the same Grammar `MessageCard` as the stop card: NIVO's mark and
 * name over the job and the time, a neutral Badge without a dot, what stopped in plain words, the class of the failure in one sentence,
 * then the neutral small buttons "Run again" and "Close" (Close asks for the reason first; a buried event only has "Run again") and
 * "Details" at the row end, which unfolds the raw codes as a bordered list. No red: the card tells, the person decides.
 */
export const TeamChatJobParkedCard = (props: TeamChatJobParkedCardProps) => {
    const { card, jobs } = props
    const [isOpen, setIsOpen] = useState(false)
    const [isClosing, setIsClosing] = useState(false)
    const isPending = jobs?.pendingId === card.jobId
    return (
        <MessageCard
            measure="wide"
            author={card.author}
            meta={card.meta}
            avatar={<ChatPartyMark size="sm" mark={card.mark} />}
            title={card.title}
            chip={<Badge tone="neutral">{card.chip}</Badge>}
            body={
                <Stack gap="row">
                    <Text>{card.message}</Text>
                    {isClosing && jobs !== undefined ? (
                        <CloseForm
                            card={card}
                            isPending={isPending}
                            onCancel={() => setIsClosing(false)}
                            onSubmit={(reason) => {
                                jobs.onAction(card.jobId, { kind: "close", reason })
                                setIsClosing(false)
                            }}
                        />
                    ) : (
                        <Cluster gap="inline">
                            {jobs === undefined ? null : (
                                <Button
                                    intent="neutral"
                                    size="sm"
                                    isPending={isPending}
                                    onPress={() => jobs.onAction(card.jobId, { kind: "resume" })}
                                >
                                    {card.labels.resume}
                                </Button>
                            )}
                            {jobs === undefined || !card.canClose ? null : (
                                <Button intent="neutral" size="sm" isDisabled={isPending} onPress={() => setIsClosing(true)}>
                                    {card.labels.close}
                                </Button>
                            )}
                            <TextAction appearance="plain" size="sm" onPress={() => setIsOpen((wasOpen) => !wasOpen)}>
                                {card.detailsLabel}
                            </TextAction>
                        </Cluster>
                    )}
                    {isOpen ? (
                        <SurfaceCard
                            kind="list"
                            layout="keyValue"
                            ariaLabel={card.factsLabel}
                            empty={null}
                            items={card.facts.map((line) => ({ id: line.id, title: line.name, value: line.value }))}
                        />
                    ) : null}
                </Stack>
            }
        />
    )
}
