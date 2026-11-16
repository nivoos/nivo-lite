import { TRIGGER } from "@nivo-lite/agent-sdk/names"
import {
    absent,
    and,
    callWorkflow,
    defineTemplateGraph,
    endRound,
    equals,
    handBack,
    ifNode,
    loop,
    memberContains,
    memberEquals,
    node,
    or,
    outcome,
    present,
    ref,
    round,
    trigger,
    wait,
    waitFor,
    type NoticeFact,
    type TemplateCatalogue,
    type TemplateGraph,
} from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { MAX_BODY, MAX_ID } from "../../../shared/bounds"
import { SALES_ORDER_ENTITY } from "../../../shared/entities/sales-entity-names"
import { salesConsultTurnNode } from "../nodes/consult-turn.node"
import { salesCreditNoticeNode } from "../nodes/credit-notice.node"
import { salesCreditReadNode } from "../nodes/credit-read.node"
import { salesNotSaleNoticeNode } from "../nodes/not-sale-notice.node"
import { salesOccasionKeepNode } from "../nodes/occasion-keep.node"
import { salesOrderCreateNode } from "../nodes/order-create.node"
import { salesOrderPaidNode } from "../nodes/order-paid.node"
import { salesOrderTalkNode } from "../nodes/order-talk.node"
import { salesOrderTellNode } from "../nodes/order-tell.node"
import { salesPaymentRemindNode } from "../nodes/payment-remind.node"
import { salesPaymentShortNode } from "../nodes/payment-short.node"
import { salesRequestPayNode } from "../nodes/request-pay.node"
import { salesRequestReadNode } from "../nodes/request-read.node"
import { salesRequestCancelNode } from "../nodes/request-cancel.node"
import { salesOrderCancelTellNode } from "../nodes/order-cancel-tell.node"
import { salesCancelPaidNoticeNode } from "../nodes/cancel-paid-notice.node"
import { salesOrderCancelNode } from "../nodes/order-cancel.node"
import { salesOrderReadNode } from "../nodes/order-read.node"
import { AWAITING_PAYMENT_STATUSES, ORDER_STATUSES } from "../rules/order-status"

/**
 * The sale's contract: what the front desk hands on (owner's final rule 7: no `recentLines`): the person's route (the callee input keeps its
 * name `conversationId` until the end sweep, R19), the words that opened the sale, the channel, the person and where the visit's window on
 * the route's lines starts (`since`: the consult reads the engine's thread from then on, pictures included; null: the whole route). The
 * talk loop then takes every later message of the person through its own `wait`.
 */
const input = z.object({
    conversationId: z.string().min(1).max(MAX_ID),
    text: z.string().max(MAX_BODY),
    channel: z.string().min(1).max(MAX_ID).nullable().optional(),
    contactId: z.string().min(1).max(MAX_ID).nullable().optional(),
    since: z.string().max(MAX_ID).nullable().optional(),
})

const LOCALE = "vi"

/**
 * ONE meaning, "the person said something", whichever of the front desk's channels it came on: one key listing the four channel verbs
 * (concept templates rule 12, v33; before, four keys of one verb each, all routed alike).
 */
const SAID = waitFor([TRIGGER.zaloMessageReceived, TRIGGER.telegramMessageReceived, TRIGGER.facebookMessageReceived, TRIGGER.instagramMessageReceived])

/**
 * ONE meaning, "the order's record was written" (v33): a write of THIS order (`blocks-core.sales.order` declares its writes as events keyed
 * by the order itself), whoever wrote it but this run (the engine never offers a run its own write): a person cancelling or settling it on
 * the workbench wakes the parked sale at once.
 */
const ORDERED = waitFor(TRIGGER.recordWritten, {
    where: [{ param: "data.type", op: "equals", value: SALES_ORDER_ENTITY }],
    match: [memberEquals("data.recordId", ref("steps.create-order.output.orderId"))],
})

/** The rounds of the talk loop: one per customer message (R9: a body that parks at a wait may run 30). */
const TALK_ROUNDS = 30

/** The rounds of the payment loop: reminders and order talks, then `unpaid` (R9). */
const PAY_ROUNDS = 6

/** The order as the payment round read it right after its wake: its record's status, never what the run saw when the order was made. */
const ORDER_NOW_STATUS = ref("steps.order-now.output.status", { default: null })

/**
 * The order's record no longer waits for money: its status is one the sales rules do not count as awaiting payment (`confirmed` and `invoiced`
 * are the only ones that do). A credit settles only an order that still waits; the list is the rules' own, never retyped here.
 */
const NO_LONGER_AWAITING = or(
    ...ORDER_STATUSES.filter((status) => !AWAITING_PAYMENT_STATUSES.includes(status)).map((status) => equals(ORDER_NOW_STATUS, status)) as [
        ReturnType<typeof equals>,
        ...Array<ReturnType<typeof equals>>,
    ],
)

/** The order's payment request as the round read it after its wake (`request-now`): `open`, `paid`, `cancelled`, `expired`, or null with none. */
const REQUEST_NOW_STATUS = ref("steps.request-now.output.status", { default: null })

/** The payment request can no longer be paid (the payer cancelled it at checkout, it lapsed): the order no longer waits for that money. */
const REQUEST_ENDED = or(equals(REQUEST_NOW_STATUS, "cancelled"), equals(REQUEST_NOW_STATUS, "expired"))

/** What woke the payment round, by the route the wait took: `credit`, `said`, `ordered`, or `timeout`. */
const WOKE_BY = ref("steps.await.output.trigger")

/**
 * The customer's message of THIS round asked to cancel the order: the round was woken by a message (only then did `order-talk` run in it)
 * and the order talk's outcome is `cancel` (the model's reading, by meaning).
 */
const CANCEL_ASKED = and(equals(WOKE_BY, "said"), equals(ref("steps.order-talk.output.topic", { default: null }), "cancel"))

/** The payment loop's own cancel step cancelled the order (its number answered; a declined cancel answers none). */
const CANCELLED_HERE = present(ref("steps.pay-cancel-order.output.orderNo", { default: null }))

/** Why the customer asked to cancel, as the order talk read it (null when they gave no reason). */
const CANCEL_REASON = ref("steps.order-talk.output.cancelReason", { default: null })

/** The consult's last word, read after the talk loop through its `last` (the consult that ended the final round). */
const CONSULT = {
    branch: ref("steps.talk.output.last.branch", { default: null }),
    contactId: ref("steps.talk.output.last.contactId", { default: null }),
} as const

/** A member of the draft the talk ended on: the loop`s `last` (the output of the round-ending step: the consult). */
const draftRef = (member: string) => ref(`steps.talk.output.last.${member}`, { default: null })

/** The label of the order's code in a team notice the engine posts for a step of the order (R68). */
const ORDER_LABEL = { vi: "Mã đơn", en: "Order" } as const

/** The order's code and total, as the engine's team notices of the order's steps name them (R68). */
const ORDER: NoticeFact = { label: ORDER_LABEL, value: ref("steps.create-order.output.orderNo") }
const TOTAL: NoticeFact = { label: { vi: "Tổng tiền", en: "Total" }, value: ref("steps.create-order.output.amountVnd") }

/** A step a person declined on its card: the engine tells the team, then the run ends `declined` (R68). */
const DECLINED_ENDS = { then: "end", outcome: "declined" } as const

const CATALOGUE: TemplateCatalogue = {
    name: { vi: "Bán hàng", en: "Sale" },
    summary: {
        vi: "Một lượt chạy cho cả việc bán: tư vấn từng tin nhắn của khách, ghi đơn, yêu cầu khách thanh toán, chờ tiền về hoặc tin nhắn về đơn, nhắc khi quá hạn",
        en: "One run for the whole sale: consults on each of the customer's messages, records the order, asks the customer to pay, waits for the money or a message about the order, reminds when it is late",
    },
    version: 34,
    publishedAt: "2026-11-15T16:00:00.000Z",
    notes: {
        vi: "Bản 34: khi chờ tiền mà khách muốn huỷ đơn, bước trao đổi về đơn không trả lời bằng lời mà chọn kết quả `muốn huỷ đơn`: quy trình đọc lại đơn và yêu cầu thanh toán, đơn còn chờ tiền thì huỷ đơn (chủ tiệm duyệt nếu bước để chế độ hỏi), rút lại yêu cầu thanh toán còn mở rồi báo khách đã huỷ và kết thúc `đã đóng`; chủ tiệm không đồng ý thì báo khách đơn được giữ và chờ tiền tiếp. Bản 33: khi chờ tiền, việc ghi lại đơn (người của tiệm hủy hoặc chốt đơn ở bàn làm việc) đánh thức quy trình ngay: quy trình đọc lại đơn, đơn không còn chờ tiền thì kết thúc `đã đóng`, không nhắc, không cảm ơn; đơn vẫn chờ tiền thì chờ tiếp, không nhắc; tin nhắn của khách trên kênh nào cũng là một loại sự kiện. Bản 32: yêu cầu thanh toán qua tài khoản nhận tiền của tiệm (link thanh toán, mã QR hoặc thông tin chuyển khoản, tùy nhà cung cấp); khoản tiền về được nhận theo mã yêu cầu của nhà cung cấp (hoặc nội dung chuyển khoản khi nhà cung cấp không giữ yêu cầu); mỗi lần chờ tiền được đánh thức, quy trình đọc lại cả yêu cầu thanh toán: khách đã hủy ở trang thanh toán hoặc yêu cầu hết hạn thì kết thúc `đã đóng`; hủy đơn thì rút lại yêu cầu còn mở. Bản 31: quy trình chỉ còn các bước bán hàng: bước bị từ chối hoặc không tới được khách thì hệ thống tự báo đội (kèm mã đơn, tổng tiền) rồi đi tiếp hoặc kết thúc như trước; hết lượt nhắc mà đơn chưa trả thì hệ thống báo đội; mỗi lần chờ tiền được đánh thức, quy trình đọc lại đơn: khoản tiền về cho đơn đã hủy hoặc đã trả không được ghi, chỉ báo đội như khoản tiền lạ, rồi kết thúc `đã đóng`",
        en: "Version 34: while waiting for the money, a customer's wish to cancel is no longer answered in words: the order talk chooses the outcome `cancel`; the run re-reads the order and its payment request and, while the order still waits for money, cancels it (the owner approves when the step is set to ask), withdraws the request still open, tells the customer it is cancelled and ends `closed`; when the owner declines, the customer is told the order stays and the wait goes on. Version 33: while waiting for the money, a write of the order (the shop cancelling or settling it on the workbench) wakes the run at once: it re-reads the order and, when the order no longer waits for money, ends `closed` with no reminder and no thank-you; an order still waiting waits on, with no reminder; the customer's message on any channel is one kind of event. Version 32: asks the customer to pay through the shop's money account (a pay link, a QR or the transfer details, as the provider gives); the money is recognised by the provider's request reference (or the transfer content when the provider keeps no request); every wake of the payment wait also reads the payment request: cancelled at checkout or expired ends the run `closed`; cancelling the order withdraws a request still open. Version 31: the workflow keeps only the sale's steps: a step declined or not delivered to the customer is told to the team by the engine (with the order's code and total), then the run goes on or ends as before; an order still unpaid after every reminder is told to the team by the engine; a bank credit or the timeout of the payment wait first reads the order as it stands now: a credit for an order that no longer waits for money (cancelled, already paid) is told to the team as a stranger credit and never recorded, the run then ends `closed`",
    },
}

/**
 * `sales.consult` version 34 (v33 + a wish to cancel during the payment wait is the order talk's outcome `cancel`, which takes the
 * payment loop's cancel road; see PAYMENT LOOP) (v33: v32 + the order's own write wakes the payment wait, `ordered`; the four channel keys are ONE key `said`)
 * (v32: v31 + the ONE payment request, owner ruling R111: see ORDER, PAYMENT LOOP and CANCEL) (v31: the payment wait
 * re-reads the order on every wake) (R68: pure business; every "was it declined / not delivered -> team notice" pair is gone: the step declares
 * its `unsuccessful` ending and the ENGINE tells the team, then goes on or ends `declined`): THE SALE AS ONE RUN (owner's final rule 7;
 * coordinator rulings R8, R9, R13, R32, R33, R41, R45, R47, R68). The key stays `sales.consult` so the front desk's hand-off and the
 * agent's primary keep their name.
 * - TALK LOOP (`talk`, until the consult settles, at most 30 rounds; R33): round 1 has no event, so it goes straight to `consult` with the
 *   hand-off's words; every later round first parks at `hear` for the person's next message (a day at most) and `consult` answers THAT
 *   message, going on from the draft the round before wrote (R13). ONE consult step; `asked` ends the round. Not about a sale (`off`, the
 *   model's judgement): a round that waited hands its message back (`give-back-talk`); in round 1 the team is told the route and the
 *   words inside the round (`not-sale-notice`, R41 Q10: a notice with its own business content), the talk ends and the run ends
 *   `not-sale`. It ends when the consult says `ready` or `cancel`, or when the person went quiet. A person declining the consult's answer
 *   on its card: the engine tells the team and the run ends `declined`. Every later step reads the draft from the loop's `last`.
 * - The dates the customer mentioned are kept (`keep-occasions`, a side step: with none the node keeps nothing; declined: the engine tells
 *   the team and the sale goes on).
 * - ORDER: `create-order` -> `request-pay` (v32: the payment request of the account the pick order chose; the node holds no provider
 *   branch; the order keeps the request's reference when the provider keeps one) -> `tell-order` (what the payer needs, as the provider
 *   gave it; declined: the engine tells the team, the run ends `declined`).
 * - PAYMENT LOOP (`pay`, until the order is recorded paid, at most 6 rounds, then `unpaid`): `await` parks for the bank credit whose `payKey`
 *   holds the request's `payKey` (v32: the provider's request reference when it keeps a request, else the transfer content the payer
 *   writes, as the provider's feed and its request declare it; never a text the graph chooses) and that is money IN (`data.direction` = `in`, R32),
 *   or a message of the person, 24 h at most. A credit: read it, the exact total records the order paid, another total tells the customer
 *   the difference and the team (`short-notice`, R32 money facts). A credit naming no waiting sale is the registered `sales.payment`
 *   graph's. A message: `order-talk` (the model decides by meaning what it is: `about` answers it; `off` hands the event back,
 *   `give-back`; v34 `cancel`, a wish to cancel this order, says nothing and takes the read of the order below: an order still waiting for
 *   money is cancelled (`pay-cancel-order`, the owner approves when the step is set to ask), its request still open withdrawn
 *   (`pay-cancel-request`) and the customer told (`pay-tell-cancelled`), then the loop leaves and the run ends `closed`; a person declining the
 *   cancel (the engine tells the team) leaves the order as it is: the customer is told it stays (`pay-tell-kept`) and the wait goes on; an
 *   order that no longer waits takes the read's own road and the run ends `closed`. Words of a hand-off never stand in for that road). The timeout: the reminder. An answer or a reminder that did not reach the customer (refused or declined; not
 *   `route_held`): the engine tells the team and the wait goes on. A person declining the paid record: the engine tells the team which
 *   order and the run ends `declined`. Paid: the after-sale is called, then `paid`. Out of rounds: the engine tells the team the order and
 *   its total, then `unpaid`. The talk loop running out ends `quiet` with no notice (a customer going quiet is normal).
 * - THE ORDER AT EVERY WAKE (v31, U-04; v32 the request too): the wait wakes on a credit, a message or its timeout; a credit and the
 *   timeout first read the order's record (`order-now`) and its payment request at the provider (`request-now`, nothing called when the
 *   order keeps no request) and go on only while the order is `confirmed` or `invoiced` AND the request is not `cancelled` / `expired`
 *   (PAYOS-9 the payer cancelled at checkout, PAYOS-10 it lapsed: no event tells NIVO, only this read). A credit settles only an order still waiting for money. Else the
 *   credit is a STRANGER credit (the registered payment graph's road): `stranger-notice` tells the team, the order is not touched, no
 *   thank-you; the timeout sends no reminder; the loop leaves and the run ends `closed` (`settled`). A message is the customer's words about
 *   the order and goes to `order-talk` as before (it cannot go through the read: a hand-back may sit only on a message's own road).
 *   v33: a write of the order by anyone but this run (a person cancelling or settling it on the workbench) wakes the wait at once under
 *   `ordered` and takes the same read: an order that no longer waits ends `closed` (no reminder, no thank-you); one still waiting waits again.
 * - CANCEL: the order's status as its record keeps it; a paid order is not cancelled by the flow (`cancel-paid-notice` tells the team the
 *   order, the reason and the words); else `cancel-order` -> `cancel-request` (v32: the order's payment request is withdrawn while still
 *   open; none kept: nothing called) -> `tell-cancelled` (declined: the engine tells the team, `declined`).
 * Every customer-facing step reads the conversation right before it speaks through the read tools (R16).
 */
export const salesConsultGraph: TemplateGraph = defineTemplateGraph({
    key: "sales.consult",
    title: CATALOGUE.name,
    catalogue: CATALOGUE,
    input: z.object({ data: input }),
    triggers: [trigger(TRIGGER.workflowCalled)],
    openTo: "any",
    start: "talk",
    nodes: {
        talk: loop({
            label: { vi: "Tư vấn", en: "Consult" },
            until: or(
                equals(ref("steps.consult.output.branch", { default: null }), "ready"),
                equals(ref("steps.consult.output.branch", { default: null }), "cancel"),
                equals(ref("steps.hear.output.trigger", { default: null }), "timeout"),
                // Round 1 (no wait ran yet) judged not about a sale: nothing to hand back, the run ends `not-sale`.
                and(equals(ref("steps.consult.output.branch", { default: null }), "off"), absent(ref("steps.hear.output.trigger", { default: null }))),
            ),
            exits: {
                until: { vi: "Thoát khi khách chốt, hủy, im lặng hoặc không phải mua hàng", en: "Leaves when the customer orders, cancels, goes quiet or is not buying" },
                exhausted: { vi: "Hết 30 vòng mà chưa chốt", en: "30 rounds without an order" },
            },
            max: TALK_ROUNDS,
            body: {
                start: "opening",
                nodes: {
                    // Round 1 has no event: its message is the hand-off's words. Every later round takes the person's next message first.
                    opening: ifNode({ label: { vi: "Vòng đầu?", en: "First round?" }, when: equals(round(), 1), yes: "consult", no: "hear" }),
                    hear: wait({
                        label: { vi: "Chờ khách nhắn", en: "Wait for the customer's message" },
                        for: { said: SAID },
                        timeout: "1d",
                        next: { said: "consult", timeout: endRound },
                    }),
                    consult: node(salesConsultTurnNode, {
                        input: {
                            conversationId: ref("trigger.data.conversationId"),
                            text: ref("trigger.data.text"),
                            // THIS round's message (null in round 1: the hand-off's `text` is the message then).
                            latest: ref("steps.hear.output.event.data.text", { default: null }),
                            draft: ref("steps.consult.output", { round: "previous", default: null }),
                            channel: ref("trigger.data.channel", { default: null }),
                            contactId: ref("trigger.data.contactId", { default: null }),
                            since: ref("trigger.data.since", { default: null }),
                            locale: LOCALE,
                        },
                        // `declined` (a person declined the answer on its card) is the step's unsuccessful ending: the engine tells the team and
                        // the run ends `declined` before the loop's check; the route is the node's own and stays wired.
                        routes: { asked: endRound, ready: endRound, cancel: endRound, declined: endRound, off: "off-round" },
                        unsuccessful: DECLINED_ENDS,
                    }),
                    // Not about a sale (the model's judgement): a round that waited hands its message back; round 1 has no wait to hand it
                    // back to, so the team is told the route and the words on /chat (R41 Q10: never silent) and the talk ends.
                    "off-round": ifNode({
                        label: { vi: "Vòng đầu?", en: "First round?" },
                        when: equals(round(), 1),
                        yes: "not-sale-notice",
                        no: "give-back-talk",
                    }),
                    // Inside the round (v28): the round then ENDS on this node step, so the loop's `last` is the notice's own output (`posted`).
                    "not-sale-notice": node(salesNotSaleNoticeNode, {
                        input: { routeId: ref("trigger.data.conversationId"), text: ref("trigger.data.text"), locale: LOCALE },
                        next: endRound,
                    }),
                    "give-back-talk": handBack({ label: { vi: "Trả lại tin", en: "Hand the message back" }, wait: "hear" }),
                },
            },
            next: "keep-occasions",
            exhausted: "quiet",
        }),
        // The occasions the customer mentioned on the way are kept first (a side step), whatever the talk came to; with none the node keeps
        // nothing and calls no tool. Declined: the engine tells the team and the sale goes on where the talk left it.
        "keep-occasions": node(salesOccasionKeepNode, {
            input: { contactId: CONSULT.contactId, occasions: draftRef("occasions") },
            next: "not-sale-said",
            unsuccessful: { then: "continue" },
        }),
        // The talk stopped on round 1's "not about a sale": that round ended on `not-sale-notice` (the team was told), so the loop's `last`
        // is the notice's output, the only round-ending step that answers `posted` (a structural member, posted or not).
        "not-sale-said": ifNode({
            label: { vi: "Không phải mua hàng?", en: "Not a sale?" },
            when: present(ref("steps.talk.output.last.posted", { default: null })),
            yes: "not-sale",
            no: "ready-said",
        }),
        "not-sale": outcome({ name: "not-sale", label: { vi: "Không phải mua hàng", en: "Not a sale" } }),
        "ready-said": ifNode({
            label: { vi: "Khách chốt đơn?", en: "Ready to order?" },
            when: equals(CONSULT.branch, "ready"),
            yes: "create-order",
            no: "cancel-said",
        }),
        "create-order": node(salesOrderCreateNode, {
            input: {
                contactId: CONSULT.contactId,
                items: draftRef("items"),
                address: draftRef("address"),
                recipientName: draftRef("recipientName"),
                recipientPhone: draftRef("recipientPhone"),
                deliveryAt: draftRef("deliveryAt"),
            },
            next: "request-pay",
            // Declined: no order exists, the customer is left without its code. The engine tells the team, the run ends `declined`.
            unsuccessful: DECLINED_ENDS,
        }),
        "request-pay": node(salesRequestPayNode, {
            input: {
                orderId: ref("steps.create-order.output.orderId"),
                orderNo: ref("steps.create-order.output.orderNo"),
                amountVnd: ref("steps.create-order.output.amountVnd"),
            },
            next: "tell-order",
        }),
        "tell-order": node(salesOrderTellNode, {
            input: {
                conversationId: ref("trigger.data.conversationId"),
                orderNo: ref("steps.create-order.output.orderNo"),
                amountVnd: ref("steps.create-order.output.amountVnd"),
                lines: ref("steps.create-order.output.lines"),
                request: ref("steps.request-pay.output"),
                locale: LOCALE,
            },
            next: "pay",
            unsuccessful: { ...DECLINED_ENDS, facts: [ORDER] },
        }),
        pay: loop({
            label: { vi: "Thanh toán", en: "Payment" },
            // The order is recorded paid, or its record no longer waits for money (the owner cancelled it, a person settled it), or its payment
            // request can no longer be paid: the run does not wait on, `settled` tells the two apart.
            until: or(present(ref("steps.paid-order.output.orderNo", { default: null })), NO_LONGER_AWAITING, REQUEST_ENDED, CANCELLED_HERE),
            exits: {
                until: {
                    vi: "Thoát khi đơn đã trả, đã huỷ hoặc không còn chờ tiền",
                    en: "Leaves when the order is paid, cancelled or no longer waits for money",
                },
                exhausted: { vi: "Hết 6 vòng mà chưa trả", en: "6 rounds and still unpaid" },
            },
            max: PAY_ROUNDS,
            body: {
                start: "await",
                nodes: {
                    await: wait({
                        label: { vi: "Chờ tiền về, tin khách hoặc đơn đổi", en: "Wait for the money, a message or a change of the order" },
                        for: {
                            // Money IN only (R32): a feed carries both directions and only a registration is narrowed by the engine, so
                            // the wait states it as the old payment graph's registration had it; a debit naming the order is no payment.
                            credit: waitFor(TRIGGER.paymentCreditReceived, {
                                where: [{ param: "data.direction", op: "equals", value: "in" }],
                                // The request's own key (R111): the provider's request reference, or the transfer content for a provider that
                                // keeps no request; a request that names none (null) takes nothing.
                                match: [memberContains("data.payKey", ref("steps.request-pay.output.payKey"))],
                            }),
                            said: SAID,
                            ordered: ORDERED,
                        },
                        timeout: "1d",
                        // A credit, a write of the order and the timeout first read the order's record as it stands NOW; a message is the
                        // customer's words about it (`order-talk` decides by meaning, and hands the event back when it is not about the order).
                        next: { credit: "order-now", said: "order-talk", ordered: "order-now", timeout: "order-now" },
                    }),
                    "order-now": node(salesOrderReadNode, {
                        input: { orderId: ref("steps.create-order.output.orderId") },
                        next: "request-now",
                    }),
                    // The order's payment request as it stands at the provider NOW (some of its states change with no event).
                    "request-now": node(salesRequestReadNode, {
                        input: { requestRef: ref("steps.order-now.output.paymentRequestRef", { default: null }) },
                        next: "awaiting",
                    }),
                    awaiting: ifNode({
                        label: { vi: "Đơn còn chờ tiền?", en: "Order still waiting for money?" },
                        when: or(NO_LONGER_AWAITING, REQUEST_ENDED),
                        yes: "closed-credit",
                        no: "credit-woke",
                    }),
                    "credit-woke": ifNode({
                        label: { vi: "Tiền về?", en: "A credit?" },
                        when: equals(WOKE_BY, "credit"),
                        yes: "credit",
                        no: "late-woke",
                    }),
                    // v33: only the timeout reminds; a write of an order that still waits for money (`ordered`) just waits again.
                    "late-woke": ifNode({
                        label: { vi: "Hết giờ chờ?", en: "The wait timed out?" },
                        when: equals(WOKE_BY, "timeout"),
                        yes: "remind",
                        no: "pay-cancel-asked",
                    }),
                    // v34: the customer's message of this round asked to cancel an order that still waits for money.
                    "pay-cancel-asked": ifNode({
                        label: { vi: "Khách muốn huỷ đơn?", en: "The customer asks to cancel?" },
                        when: CANCEL_ASKED,
                        yes: "pay-cancel-order",
                        no: endRound,
                    }),
                    // The order is cancelled (the owner approves first when the step is set to ask). A person declining it is their
                    // decision: the engine tells the team which order, the order stays, and the round goes on to tell the customer.
                    "pay-cancel-order": node(salesOrderCancelNode, {
                        input: { orderId: ref("steps.create-order.output.orderId"), reason: CANCEL_REASON },
                        next: "pay-cancelled",
                        unsuccessful: { then: "continue", facts: [ORDER] },
                    }),
                    "pay-cancelled": ifNode({
                        label: { vi: "Đã huỷ đơn?", en: "Order cancelled?" },
                        when: CANCELLED_HERE,
                        yes: "pay-cancel-request",
                        no: "pay-tell-kept",
                    }),
                    // The cancelled order's payment request is withdrawn while it can still be paid (none kept: nothing is called).
                    "pay-cancel-request": node(salesRequestCancelNode, {
                        input: { requestRef: ref("steps.order-now.output.paymentRequestRef", { default: null }), reason: CANCEL_REASON },
                        next: "pay-tell-cancelled",
                    }),
                    // Then the customer hears how it ended, and the loop leaves (`CANCELLED_HERE`): the run ends `closed`.
                    "pay-tell-cancelled": node(salesOrderCancelTellNode, {
                        input: {
                            conversationId: ref("trigger.data.conversationId"),
                            orderNo: ref("steps.pay-cancel-order.output.orderNo", { default: null }),
                            cancelled: true,
                            locale: LOCALE,
                        },
                        next: endRound,
                        unsuccessful: { facts: [ORDER] },
                    }),
                    // The owner kept the order: the customer is told it stays, and the wait goes on.
                    "pay-tell-kept": node(salesOrderCancelTellNode, {
                        input: {
                            conversationId: ref("trigger.data.conversationId"),
                            orderNo: ref("steps.create-order.output.orderNo"),
                            cancelled: false,
                            locale: LOCALE,
                        },
                        next: endRound,
                        unsuccessful: { facts: [ORDER] },
                    }),
                    // The order no longer waits for money. A credit that names it is never recorded: it is a stranger credit, the team is told
                    // (the same notice as any credit the sale cannot settle); the timeout and a write of the order send nothing. Then the loop
                    // leaves and the run ends `closed`.
                    "closed-credit": ifNode({
                        label: { vi: "Tiền về?", en: "A credit?" },
                        when: equals(WOKE_BY, "credit"),
                        yes: "stranger-read",
                        no: endRound,
                    }),
                    "stranger-read": node(salesCreditReadNode, {
                        input: { transactionId: ref("steps.await.output.event.data.transactionId") },
                        next: "stranger-notice",
                    }),
                    "stranger-notice": node(salesCreditNoticeNode, {
                        input: {
                            transactionId: ref("steps.stranger-read.output.transactionId"),
                            amountVnd: ref("steps.stranger-read.output.amountVnd"),
                            content: ref("steps.stranger-read.output.content"),
                            locale: LOCALE,
                        },
                        next: endRound,
                    }),
                    credit: node(salesCreditReadNode, {
                        input: { transactionId: ref("steps.await.output.event.data.transactionId") },
                        next: "exact",
                    }),
                    exact: ifNode({
                        label: { vi: "Đủ tiền?", en: "Exact amount?" },
                        when: equals(ref("steps.credit.output.amountVnd"), ref("steps.create-order.output.amountVnd")),
                        yes: "paid-order",
                        no: "short",
                    }),
                    // Declined on its card (R41 Q8): the order stays unpaid; the engine tells the team which order, the run ends `declined`.
                    "paid-order": node(salesOrderPaidNode, {
                        input: { orderId: ref("steps.create-order.output.orderId") },
                        next: endRound,
                        unsuccessful: { ...DECLINED_ENDS, facts: [ORDER] },
                    }),
                    short: node(salesPaymentShortNode, {
                        input: {
                            contactId: CONSULT.contactId,
                            orderNo: ref("steps.create-order.output.orderNo"),
                            orderAmountVnd: ref("steps.create-order.output.amountVnd"),
                            creditAmountVnd: ref("steps.credit.output.amountVnd"),
                            locale: LOCALE,
                        },
                        next: "short-notice",
                    }),
                    // A credit the sale cannot settle by itself is never silent (R32): the team is told its amount and content too.
                    "short-notice": node(salesCreditNoticeNode, {
                        input: {
                            transactionId: ref("steps.credit.output.transactionId"),
                            amountVnd: ref("steps.credit.output.amountVnd"),
                            content: ref("steps.credit.output.content"),
                            locale: LOCALE,
                        },
                        next: endRound,
                    }),
                    // An answer about the order that did not reach the customer: the engine tells the team, the wait goes on (R45, R68).
                    "order-talk": node(salesOrderTalkNode, {
                        input: {
                            contactId: CONSULT.contactId,
                            text: ref("steps.await.output.event.data.text", { default: "" }),
                            orderNo: ref("steps.create-order.output.orderNo"),
                            amountVnd: ref("steps.create-order.output.amountVnd"),
                            locale: LOCALE,
                        },
                        // `off`: not about the order: the message goes back to whoever else waits for it (the front desk), the round ends.
                        // `cancel` (v34): a wish to cancel this order: nothing was said; the order and its request are read as they stand
                        // NOW, and an order still waiting for money takes the cancel road below (`pay-cancel-asked`).
                        routes: { about: endRound, off: "give-back", cancel: "order-now" },
                        unsuccessful: { facts: [ORDER] },
                    }),
                    "give-back": handBack({ label: { vi: "Trả lại tin", en: "Hand the message back" }, wait: "await" }),
                    // A reminder the channel refused (a closed window, an opted-out customer): the engine tells the team, the wait goes on.
                    remind: node(salesPaymentRemindNode, {
                        input: {
                            contactId: CONSULT.contactId,
                            orderNo: ref("steps.create-order.output.orderNo"),
                            amountVnd: ref("steps.create-order.output.amountVnd"),
                            locale: LOCALE,
                        },
                        next: endRound,
                        unsuccessful: { facts: [ORDER] },
                    }),
                },
            },
            next: "settled",
            // Out of rounds: the engine tells the team the order and its total (R45), the run ends `unpaid`.
            exhausted: "unpaid",
            unsuccessful: { facts: [ORDER, TOTAL] },
        }),
        // The loop left: either the order was recorded paid (its last round ended on `paid-order`) or its record stopped waiting for money.
        settled: ifNode({
            label: { vi: "Đã ghi đơn trả?", en: "Recorded paid?" },
            when: present(ref("steps.pay.output.last.orderNo", { default: null })),
            yes: "to-after-sale",
            no: "closed",
        }),
        closed: outcome({
            name: "closed",
            label: { vi: "Đơn đã đóng", en: "Order closed" },
            output: { contactId: ref("trigger.data.contactId", { default: null }), orderId: ref("steps.create-order.output.orderId"), orderNo: ref("steps.create-order.output.orderNo") },
        }),
        "to-after-sale": callWorkflow({
            agent: "sales",
            workflow: "after-sale",
            version: "latest",
            input: {
                orderId: ref("steps.create-order.output.orderId"),
                orderNo: ref("steps.create-order.output.orderNo"),
                contactId: CONSULT.contactId,
            },
            next: "paid",
        }),
        paid: outcome({
            name: "paid",
            label: { vi: "Đã trả", en: "Paid" },
            output: { contactId: ref("trigger.data.contactId", { default: null }), orderId: ref("steps.create-order.output.orderId"), orderNo: ref("steps.create-order.output.orderNo") },
        }),
        unpaid: outcome({
            name: "unpaid",
            label: { vi: "Chưa trả", en: "Unpaid" },
            output: { contactId: ref("trigger.data.contactId", { default: null }), orderId: ref("steps.create-order.output.orderId"), orderNo: ref("steps.create-order.output.orderNo") },
        }),
        "cancel-said": ifNode({
            label: { vi: "Khách hủy đơn?", en: "Cancel the order?" },
            when: equals(CONSULT.branch, "cancel"),
            yes: "cancel-read",
            no: "quiet",
        }),
        // The cancel branches on DATA: the order's status as its record keeps it. A paid order is not cancelled by the flow: the team is told.
        "cancel-read": node(salesOrderReadNode, { input: { orderId: draftRef("cancelOrderId") }, next: "cancel-paid" }),
        "cancel-paid": ifNode({
            label: { vi: "Đơn đã trả?", en: "Already paid?" },
            when: equals(ref("steps.cancel-read.output.status"), "paid"),
            yes: "cancel-paid-notice",
            no: "cancel-order",
        }),
        "cancel-paid-notice": node(salesCancelPaidNoticeNode, {
            input: { orderNo: ref("steps.cancel-read.output.orderNo"), reason: draftRef("cancelReason"), text: ref("trigger.data.text"), locale: LOCALE },
            next: "quiet",
        }),
        "cancel-order": node(salesOrderCancelNode, {
            input: { orderId: ref("steps.cancel-read.output.orderId"), reason: draftRef("cancelReason") },
            next: "cancel-request",
            unsuccessful: { ...DECLINED_ENDS, facts: [{ label: ORDER_LABEL, value: ref("steps.cancel-read.output.orderNo") }] },
        }),
        // The cancelled order's payment request is withdrawn while it can still be paid (none kept: nothing is called). A refused withdrawal
        // is a failed act: the engine stops the run for a person.
        "cancel-request": node(salesRequestCancelNode, {
            input: { requestRef: ref("steps.cancel-read.output.paymentRequestRef", { default: null }), reason: draftRef("cancelReason") },
            next: "tell-cancelled",
        }),
        "tell-cancelled": node(salesOrderCancelTellNode, {
            input: {
                conversationId: ref("trigger.data.conversationId"),
                orderNo: ref("steps.cancel-order.output.orderNo", { default: null }),
                cancelled: true,
                locale: LOCALE,
            },
            next: "quiet",
            unsuccessful: { ...DECLINED_ENDS, facts: [{ label: ORDER_LABEL, value: ref("steps.cancel-order.output.orderNo", { default: null }) }] },
        }),
        declined: outcome({ name: "declined", label: { vi: "Bị từ chối", en: "Declined" } }),
        // The person went quiet, or the talk ended with nothing to order: the run ends; a later message starts at the front desk again.
        quiet: outcome({ name: "quiet", label: { vi: "Khách im lặng", en: "Customer went quiet" } }),
    },
})
