import { TRIGGER } from "@nivo-lite/agent-sdk/names"
import {
    type TemplateGraph,
    absent,
    defineTemplateGraph,
    endRound,
    equals,
    handBack,
    ifNode,
    item,
    loop,
    node,
    or,
    outcome,
    present,
    ref,
    round,
    trigger,
    wait,
    waitFor,
} from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { webrenewCloseRecordNode } from "../nodes/close-record.node"
import { webrenewCloseTeamNode } from "../nodes/close-team.node"
import { webrenewCloseThankNode } from "../nodes/close-thank.node"
import { webrenewPaidAckNode } from "../nodes/paid-ack.node"
import { webrenewPaidTeamNode } from "../nodes/paid-team.node"
import { webrenewQuoteOpenNode } from "../nodes/quote-open.node"
import { webrenewQuoteRecordNode } from "../nodes/quote-record.node"
import { webrenewQuoteTellNode } from "../nodes/quote-tell.node"
import { webrenewReplyAnswerNode } from "../nodes/reply-answer.node"
import { webrenewRoundMessageNode } from "../nodes/round-message.node"
import { webrenewUnderstandOpenNode } from "../nodes/understand-open.node"
import { webrenewUnlinkedTellNode } from "../nodes/unlinked-tell.node"
import { webdeskUnderstandSalesNode } from "../../webdesk/nodes/understand-sales.node"

/** The language the team reads (today's constant param). */
const LOCALE = "vi"

/** The graph's contract: what the caller (the support front desk) supplies; as version 5. */
const answerInput = z.object({
    text: z.string().min(1),
    conversationId: z.string().min(1).max(100).nullish(),
    contactId: z.string().min(1).max(100).nullish(),
    channel: z.string().min(1).max(100).nullish(),
    customerCode: z.string().min(1).max(80).nullish(),
})

/** Where the answer came from, as every customer-facing step takes it: the caller may pass neither id (null then). */
const SOURCE = {
    conversationId: ref("trigger.data.conversationId", { default: null }),
    contactId: ref("trigger.data.contactId", { default: null }),
    locale: LOCALE,
}

/** The rounds of the talk: one per message of the customer (R9: a body that parks at a wait may run 30). */
const TALK_ROUNDS = 30

/** The words THIS round answers (`message`: the hand-off's in round 1, the ones the round's wait took later). */
const ROUND_TEXT = ref("steps.message.output.text")

/** A member of the understand step that ended the talk: the loop's `last` (R46: the last NODE step of the final round). */
const ended = (member: string) => ref(`steps.talk.output.last.${member}`, { default: null })

/** The linked CRM customer the ending round's understand step read; null when the conversation is linked to none. */
const CUSTOMER_CODE = ended("customerCode")

/** The understand step's route in the round that just ended. */
const routed = (branch: string) => equals(ref("steps.understand.output.branch", { default: null }), branch)

/**
 * `webrenew.answer` version 17 (Customer answers a renewal). Change from version 16 (the ONE customer send): `tell` is ONE step with
 * ONE write again (version 16 split it by channel into `tell`, `tell-mail`, `tell-told` because mail was a second tool; mail is now the
 * channel `email` of the one send, so the steps after read `tell` as in version 15). Version 15: THE CONVERSATION AS ONE RUN (owner's rule, R53; the form of
 * `sales.consult`). The business of version 13 is kept step for step; only the form moved (WEBCORE-AUDIT.md, webrenew BEFORE / AFTER):
 * - TALK LOOP (`talk`, at most 30 rounds). Round 1 answers the front door's hand-off. Every later round parks at `hear` for the
 *   customer's next Zalo message (a day at most) and first runs the FRONT DOOR'S OWN judgement (`desk`, `webdesk.understand`, the step
 *   that decided whether a run of v13 started): `renewal` goes on; anything else is handed back (`give-back`) to the graphs registered
 *   on the message (the front door), where v13 would have sent it. `message` takes the round's words.
 * - Each round runs v13's `understand` (the conversation's linked CRM customer, four routes). ask: `reply` answers the customer; when the
 *   conversation is linked to no CRM customer (`linked`, an exact check) `unlinked-tell` tells the team (side); the round ends and the
 *   talk waits for the customer. agree, paid, no: the round ends and so does the talk.
 * - AFTER THE TALK (`settled`), read from the understand step that ended it (`last`): agree -> `open-each` (one renewal request per
 *   service) -> `tell` (the CRM's totals and payment codes) -> `record-each`; no -> `close-each` -> `close-team` (side) -> `close-thank`
 *   (side) -> `declined` with the reason; paid -> `paid-team` (side) -> `paid-ack`. Accounting hears of the money from the bank.
 * - Declined (a person declined an asked step, a decision): the step's unsuccessful ending (R68): the ENGINE tells the team with the
 *   service's or the customer's code. Inside a list loop that service's item ends; on `tell` and `paid-ack` the run ends `declined`
 *   (reason null), as in v13; `reply` sits in the talk: `reply-declined` ends the round and the talk, then `declined`. A quote with every
 *   request declined (`tell-declined`, each request already told) ends `declined` with no post of its own.
 * - The customer going quiet (a day without a message) or 30 rounds end the talk `answered`: the only rounds that do not end the talk
 *   are answered questions, so this is v13's outcome of the last message; a later message starts at the front door again.
 */
export const answerGraph: TemplateGraph = defineTemplateGraph({
    key: "webrenew.answer",
    title: { vi: "Khách trả lời gia hạn", en: "Customer answers a renewal" },
    input: z.object({ data: answerInput }),
    triggers: [trigger(TRIGGER.workflowCalled)],
    openTo: "any",
    start: "talk",
    catalogue: {
        name: { vi: "Khách trả lời gia hạn", en: "Customer answers a renewal" },
        summary: {
            vi: "Lễ tân Hỗ trợ chuyển câu trả lời của khách: đồng ý thì báo giá và yêu cầu trả tiền trước, báo đã chuyển thì nhắn khách, báo đội (Kế toán nghe tiền từ ngân hàng), từ chối thì ghi nhận, hỏi thêm thì trả lời",
            en: "The support front desk passes the customer's answer on: agrees, quote and ask to pay first; says they paid, tell the customer and the team (Accounting hears of the money from the bank); declines, record it; asks, answer",
        },
        version: 18,
        // The old JSON template had `seedActive: true`: the seed makes an ACTIVE workflow from it.
        seedActive: true,
        publishedAt: "2026-11-14T22:00:00.000Z",
        notes: {
            vi: "Bản 18: bước chờ lưu mỗi khóa với danh sách sự kiện của nó (một ý nghĩa, một đường đi); cách chạy không đổi. R68: bước bị từ chối duyệt thì hệ thống tự báo đội kèm mã dịch vụ hoặc mã khách; quy trình chỉ còn các bước nghiệp vụ. Bước báo giá lại là một bước duy nhất, một lần gửi (thư là một kênh của lần gửi đó)",
            en: "Version 18: the wait keeps each key with its list of events (one meaning, one route); the run is unchanged. R68: a declined step is told to the team by the engine with the service's or the customer's code; the workflow keeps only its business steps. The quote send is one step with one send again (mail is a channel of the one send)",
        },
    },
    nodes: {
        talk: loop({
            label: { vi: "Trò chuyện gia hạn", en: "Renewal talk" },
            exits: {
                until: { vi: "Thoát khi khách đồng ý, báo đã trả, từ chối hoặc im lặng", en: "Ends when the customer agrees, says paid, says no or goes quiet" },
                exhausted: { vi: "Hết 30 vòng", en: "30 rounds used" },
            },
            until: or(
                routed("agree"),
                routed("paid"),
                routed("no"),
                equals(ref("steps.reply.output.declined", { default: false }), true),
                equals(ref("steps.hear.output.trigger", { default: null }), "timeout"),
            ),
            max: TALK_ROUNDS,
            body: {
                start: "opening",
                nodes: {
                    // Round 1 has no event: its message is the hand-off's. Every later round takes the customer's next message first.
                    opening: ifNode({
                        label: { vi: "Vòng đầu?", en: "First round?" },
                        when: equals(round(), 1),
                        yes: "message",
                        no: "hear",
                    }),
                    hear: wait({
                        label: { vi: "Chờ khách nhắn tiếp (tối đa 1 ngày)", en: "Waits for the customer's next message (a day at most)" },
                        for: { zalo: waitFor(TRIGGER.zaloMessageReceived) },
                        timeout: "1d",
                        next: { zalo: "desk", timeout: endRound },
                    }),
                    // The front door's own judgement of the message (what started a run of v13): not about a renewal -> back to it.
                    desk: node(webdeskUnderstandSalesNode, {
                        input: { text: ref("steps.hear.output.event.data.text") },
                        routes: {
                            renewal: "message",
                            fault: "give-back",
                            sales: "give-back",
                            complaint: "give-back",
                            question: "give-back",
                        },
                    }),
                    "give-back": handBack({ wait: "hear", label: { vi: "Trả tin về Lễ tân", en: "Back to the front door" } }),
                    message: node(webrenewRoundMessageNode, {
                        input: { handed: ref("trigger.data.text"), latest: ref("steps.hear.output.event.data.text", { default: null }) },
                        next: "understand",
                    }),
                    understand: node(webrenewUnderstandOpenNode, {
                        input: { text: ROUND_TEXT, ...SOURCE },
                        routes: { agree: endRound, paid: endRound, no: endRound, ask: "reply" },
                    }),
                    // ask
                    reply: node(webrenewReplyAnswerNode, {
                        input: {
                            text: ROUND_TEXT,
                            summary: ref("steps.understand.output.summary"),
                            customerCode: ref("steps.understand.output.customerCode", { default: null }),
                            ...SOURCE,
                        },
                        next: "reply-declined",
                        // R68: a person declining the reply is told to the team by the ENGINE with the customer's code (was the
                        // `reply-notice` node). Inside the talk (an `until` body) the step goes on to its exit: `reply-declined` ends
                        // the round, and the talk's `until` ends the talk on it.
                        unsuccessful: {
                            then: "continue",
                            facts: [{ label: { vi: "Mã khách hàng", en: "Customer" }, value: ref("steps.understand.output.customerCode", { default: null }) }],
                        },
                    }),
                    // Business, kept: a declined reply ends the round (and the talk: `until`), then `declined`.
                    "reply-declined": ifNode({
                        label: { vi: "Bị từ chối trả lời?", en: "Reply declined?" },
                        when: equals(ref("steps.reply.output.declined"), true),
                        yes: endRound,
                        no: "linked",
                    }),
                    linked: ifNode({
                        label: { vi: "Chưa liên kết khách CRM?", en: "No CRM customer linked?" },
                        when: absent(ref("steps.understand.output.customerCode")),
                        yes: "unlinked-tell",
                        no: endRound,
                    }),
                    "unlinked-tell": node(webrenewUnlinkedTellNode, {
                        input: {
                            contactId: ref("trigger.data.contactId", { default: null }),
                            summary: ref("steps.understand.output.summary"),
                            locale: LOCALE,
                        },
                        next: endRound,
                    }),
                },
            },
            next: "settled",
            exhausted: "answered",
        }),
        // The talk ended on its understand step (agree, paid, no): that output is the loop's `last`. Else the declined reply ended it
        // (`declined` true on the reply's output, R68: no notice node any more), or the customer went quiet after an answered question
        // (a round of control steps only: `last` is null).
        settled: ifNode({
            label: { vi: "Khách đã quyết?", en: "Customer decided?" },
            when: present(ended("branch")),
            yes: "agree-said",
            no: "declined-said",
        }),
        "declined-said": ifNode({
            label: { vi: "Bị từ chối trả lời?", en: "Reply declined?" },
            when: equals(ended("declined"), true),
            yes: "declined",
            no: "answered",
        }),
        "agree-said": ifNode({
            label: { vi: "Khách đồng ý gia hạn?", en: "Customer agrees?" },
            when: equals(ended("branch"), "agree"),
            yes: "open-each",
            no: "paid-said",
        }),
        "paid-said": ifNode({
            label: { vi: "Khách báo đã trả?", en: "Customer says paid?" },
            when: equals(ended("branch"), "paid"),
            yes: "paid-team",
            no: "close-each",
        }),

        // agree
        "open-each": loop({
            label: { vi: "Mở yêu cầu từng dịch vụ", en: "Open a request per service" },
            over: ended("serviceCodes"),
            concurrency: 1,
            body: {
                start: "open",
                nodes: {
                    open: node(webrenewQuoteOpenNode, {
                        input: {
                            serviceCode: item(),
                            termMonths: ended("termMonths"),
                            locale: LOCALE,
                        },
                        // R68: a person declining this request is told to the team by the ENGINE with the service's code; the item
                        // ends here (its output says `declined`), the quote names the others (was `open-declined` + `open-notice`).
                        unsuccessful: { then: "continue", facts: [{ label: { vi: "Mã dịch vụ", en: "Service" }, value: item() }] },
                    }),
                },
                collect: "open",
            },
            next: "tell",
        }),
        tell: node(webrenewQuoteTellNode, {
            input: { customerCode: CUSTOMER_CODE, quotes: ref("steps.open-each.output"), ...SOURCE },
            next: "tell-declined",
            // R68: a person declining the quote's send is told to the team by the ENGINE with the customer's code; the run ends
            // `declined` (was the `tell-notice` node).
            unsuccessful: { then: "end", outcome: "declined", facts: [{ label: { vi: "Mã khách hàng", en: "Customer" }, value: CUSTOMER_CODE }] },
        }),
        // Business, kept: every request was declined (each one already told by the engine), so there is nothing to quote: `declined`.
        "tell-declined": ifNode({
            label: { vi: "Không còn yêu cầu nào để báo giá?", en: "Nothing left to quote?" },
            when: equals(ref("steps.tell.output.declined"), true),
            yes: "declined",
            no: "record-each",
        }),
        // Over the services the customer was told a quote for (`tell` answers them, never null), one record each.
        "record-each": loop({
            label: { vi: "Ghi báo giá từng dịch vụ", en: "Record the quote per service" },
            over: ref("steps.tell.output.serviceCodes"),
            concurrency: 1,
            body: {
                start: "record",
                nodes: {
                    record: node(webrenewQuoteRecordNode, {
                        input: {
                            serviceCode: item(),
                            channel: ref("steps.tell.output.channel", { default: null }),
                            messageRef: ref("steps.tell.output.messageRef", { default: null }),
                        },
                        // R68: a declined record is told to the team by the ENGINE with the service's code; the item ends here.
                        unsuccessful: { then: "continue", facts: [{ label: { vi: "Mã dịch vụ", en: "Service" }, value: item() }] },
                    }),
                },
                collect: "record",
            },
        }),

        // no
        "close-each": loop({
            label: { vi: "Ghi khách từ chối từng dịch vụ", en: "Record the no per service" },
            over: ended("serviceCodes"),
            concurrency: 1,
            body: {
                start: "close-record",
                nodes: {
                    "close-record": node(webrenewCloseRecordNode, {
                        input: { serviceCode: item(), channel: ref("trigger.data.channel", { default: null }) },
                        // R68: a declined record is told to the team by the ENGINE with the service's code; the item ends here.
                        unsuccessful: { then: "continue", facts: [{ label: { vi: "Mã dịch vụ", en: "Service" }, value: item() }] },
                    }),
                },
                collect: "close-record",
            },
            next: "close-team",
        }),
        "close-team": node(webrenewCloseTeamNode, {
            input: {
                customerCode: CUSTOMER_CODE,
                recorded: ref("steps.close-each.output"),
                text: ended("text"),
                summary: ended("summary"),
                locale: LOCALE,
            },
            next: "close-thank",
        }),
        "close-thank": node(webrenewCloseThankNode, {
            input: { text: ended("text"), summary: ended("summary"), ...SOURCE },
            next: "declined",
        }),
        // A no: the customer's (`reason` from close-team) or a person's decline of an asked step outside a list loop (tell, reply,
        // paid-ack: the engine told the team; nothing else runs; `reason` is null).
        declined: outcome({
            name: "declined",
            label: { vi: "Từ chối", en: "Declined" },
            output: { reason: ref("steps.close-team.output.reason", { default: null }) },
        }),
        // The talk ended after answered questions (the customer went quiet, or 30 rounds): v13's outcome of an answered question.
        answered: outcome({ name: "answered", label: { vi: "Đã trả lời", en: "Answered" } }),

        // paid
        "paid-team": node(webrenewPaidTeamNode, {
            input: {
                text: ended("text"),
                summary: ended("summary"),
                customerCode: CUSTOMER_CODE,
                serviceCodes: ended("serviceCodes"),
                renewalId: ended("renewalId"),
                locale: LOCALE,
            },
            next: "paid-ack",
        }),
        "paid-ack": node(webrenewPaidAckNode, {
            input: { text: ended("text"), ...SOURCE },
            // R68: a person declining the acknowledgement is told to the team by the ENGINE with the customer's code; the run ends
            // `declined` (was `paid-declined` + `paid-notice`). Acknowledged: the run ends here, as before.
            unsuccessful: { then: "end", outcome: "declined", facts: [{ label: { vi: "Mã khách hàng", en: "Customer" }, value: CUSTOMER_CODE }] },
        }),
    },
})
