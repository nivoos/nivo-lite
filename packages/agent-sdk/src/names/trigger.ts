import type { TriggerVerb } from "./index"

/**
 * The verb of every trigger that may head a graph. A customer channel has its own verb (coordinator ruling R6, 2026-11-12): a Zalo
 * message is `zaloMessageReceived` (provider `zalo_oa`), a Telegram message `telegramMessageReceived` (provider `telegram`), the website
 * form `websiteMessageReceived` (the engine's road, no provider), a Facebook message `facebookMessageReceived` and an Instagram message
 * `instagramMessageReceived` (provider `meta`, each Meta channel its own verb). Every bank feed is `paymentCreditReceived`;
 * the providers a trigger listens on are named beside the verb, never in it.
 */
export const TRIGGER = {
    /** A customer said something in a Zalo OA conversation (provider `zalo_oa`). */
    zaloMessageReceived: "nivo.trigger.zalo.message.received",
    /** A customer said something in a Telegram conversation (provider `telegram`). */
    telegramMessageReceived: "nivo.trigger.telegram.message.received",
    /** A customer said something in a Facebook Page conversation (provider `meta`). */
    facebookMessageReceived: "nivo.trigger.facebook.message.received",
    /** A customer said something in an Instagram conversation (provider `meta`). */
    instagramMessageReceived: "nivo.trigger.instagram.message.received",
    /** A visitor sent the website form (the engine's road: no provider). */
    websiteMessageReceived: "nivo.trigger.website.message.received",
    /** A bank credit arrived (providers `sepay`, `casso`). */
    paymentCreditReceived: "nivo.trigger.payment.credit.received",
    /**
     * A person mailed an attached mailbox: their line on the mail channel (MAIL-IN), on the route of the mailbox account (an `imap` inbound
     * half, or a mailbox `smtp` account holding it); a mail no person wrote (an auto-reply, a list, a bounce) is none.
     */
    mailMessageReceived: "nivo.trigger.mail.message.received",
    /**
     * A render a compose provider was asked for finished, done or failed (providers `shotstack`, `creatomate`, `json2video`). Supplies
     * `renderRowId`, `renderId` and `status`, and, filled from the stored render row, `outputUrl`, `error` and `provider`; the run that
     * started the render waits for it with a `wait` matching its own `renderId`.
     */
    videoRenderCompleted: "nivo.trigger.video.render.completed",
    /** A moment of the clock came (args `{ preset, at? }`). */
    clockTick: "nivo.trigger.clock.tick",
    /**
     * A timer a run armed came due. Supplies `careKind`, `ref`, `dueAt`, the `item` it is for (the occasion's id) and the `data` it
     * carries back (`data.shipWaits`) when the arm gave them, and `suffix` (the item, for the graphs of before). A timer armed with the
     * generic `nivo.tool.timer.arm` supplies `ref` (the caller's key), `data` (what it armed), `dueAt` and its subject (`contactId`, else
     * `conversationId`): a graph registers `where: { ref }` to take exactly its own.
     */
    timerDue: "nivo.trigger.timer.due",
    /** A member said something in a team chat group. */
    chatMessageReceived: "nivo.trigger.chat.message.received",
    /** Another workflow called this one. */
    workflowCalled: "nivo.trigger.workflow.called",
    /**
     * A record of a type that declares `events` was written (created, changed or soft-deleted; concept agent-data rule 2): supplies, in
     * `data`, the `type`, the `recordId`, the `op`, the `version`, the `writer` kind, the `subject` the type declares and the declared enum
     * `fields`. Ids only: the node reads the record. A graph registers `where: [{ param: "data.type", op: "equals", value }]`.
     */
    recordWritten: "nivo.trigger.record.written",
} as const

/** Compiles only when every value is a declared name: a constant whose id is not a key of the names interface is a compile error. */
type Declared<T extends Readonly<Record<string, TriggerVerb>>> = T

/** The name of one core trigger constant. */
export type CoreTriggerConstant = keyof Declared<typeof TRIGGER>
