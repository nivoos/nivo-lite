import { chatbotAnswerNode } from "../../agents/chatbot/nodes/answer.node"
import { chatbotHearNode } from "../../agents/chatbot/nodes/hear.node"
import { chatbotUnderstandNode } from "../../agents/chatbot/nodes/understand.node"
import { salesConsultTurnNode } from "../../agents/sales/nodes/consult-turn.node"
import { salesOrderTalkNode } from "../../agents/sales/nodes/order-talk.node"
import { salesPaidClaimReplyNode } from "../../agents/sales/nodes/paid-claim-reply.node"

// SDK-DECL (E-FIX12 rule A-7): the nodes whose step does the CONSUMING read of the subject's stream (the run's queue `ctx.run.queue`, the
// person's lines read with `consume: true`) declare `readsHeldEvents`, so a visit of them after a person's decision may take the events
// held behind the run. A node that reads the thread only for context declares nothing: a line read only for context is not consumed.
describe("the nodes that consume the subject's stream declare that they read its held events", () => {
    it.each([
        ["chatbot.hear", chatbotHearNode],
        ["sales.consult-turn", salesConsultTurnNode],
        ["sales.order-talk", salesOrderTalkNode],
        ["sales.paid-claim-reply", salesPaidClaimReplyNode],
    ])("%s", (id, node) => {
        expect(node.id).toBe(id)
        expect(node.readsHeldEvents).toBe(true)
    })

    it.each([
        ["chatbot.understand", chatbotUnderstandNode],
        ["chatbot.answer", chatbotAnswerNode],
    ])("%s reads the thread for context only (it consumes nothing) and declares nothing", (id, node) => {
        expect(node.id).toBe(id)
        expect(node.readsHeldEvents).toBeUndefined()
    })
})
