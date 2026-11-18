import { z } from "zod"
import type { ContactConversationMessages, ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { TelegramMessage } from "@starci/nivoos-provider-templates/telegram/telegram.provider.cell"
import { keyOf } from "../../../package-key.ts"
import type { BrainSearch } from "../common/brain-search.ts"
import { LEADS_POLICY } from "../common/leads.guidance.ts"

export const AnswerInput = z.strictObject({
    messages: z.array(TelegramMessage).min(1).max(50),
    summary: z.string().min(1).max(300),
})
/** `answered` false: the public information does not answer; `question` is then what the team must answer, and nothing is sent. */
export const AnswerOutput = z.strictObject({
    answered: z.boolean(),
    reply: z.string().max(1500),
    question: z.string().max(400),
})
/** How many thread lines and brain hits the answer reads. A workspace may change them in the console. */
export const AnswerSettings = z.strictObject({
    threadLines: z.number().int().min(1).max(50).default(10),
    brainHits: z.number().int().min(1).max(20).default(8),
})

type In = z.infer<typeof AnswerInput>
type Out = z.infer<typeof AnswerOutput>
type Settings = z.infer<typeof AnswerSettings>

const GOAL =
    "The person wrote `messages` (oldest first); `thread` is the recent conversation, oldest first; `brain` is what NIVO's public information says nearest to the question. " +
    "Write ONE chat message for them as `reply`: a person from the team approves it and the next step sends it. Answer ONLY from `brain`. " +
    "When `brain` does not answer, set `answered` to false, leave `reply` empty and write in `question` (Vietnamese) the question the team must answer. " +
    "A greeting needs no truth: greet back warmly and ask what their business is and what they want NIVO to do, `answered` true. " +
    "When they show interest, offer a demo (a person shows NIVO working for their kind of business) and do not invent its terms. One to three sentences, at most ONE question. " +
    "Leave `question` empty when you answered."

/**
 * `nivo-gtm.leads-answer` (Trả lời từ thông tin công khai): the front door's answer. It reads the conversation and searches the brain with the person's words; the run is on a contact, so the
 * engine gives it the PUBLIC lens and nothing internal can reach the reply. ONE generation writes the reply or says it cannot; when the brain does not answer, `answered` is false and the workflow tells the team and ends `no_answer`. The send is the next step, and it asks.
 */
export class Answer implements Node<typeof AnswerInput, typeof AnswerOutput, typeof AnswerSettings> {
    readonly key = keyOf("leads-answer")
    readonly version = 3
    readonly title = { vi: "Trả lời từ thông tin công khai", en: "Answer from public information" }
    readonly input = AnswerInput
    readonly output = AnswerOutput
    readonly settings = AnswerSettings
    readonly reads = ["contact_conversation.messages", "brain.search"]
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "fast" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        const thread = reach.call<ContactConversationMessages>("contact_conversation.messages", {
            limit: reach.settings.threadLines,
        }).result.messages
        const words = input.messages
            .map((message) => message.text)
            .join("\n")
            .trim()
        const hits = reach.call<BrainSearch>("brain.search", {
            query: words === "" ? input.summary : words.slice(0, 2000),
            limit: reach.settings.brainHits,
        }).result.hits
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${LEADS_POLICY}\n\n${GOAL}`,
            data: {
                messages: input.messages.map((message) => ({ text: message.text, at: message.sentAt })),
                thread: thread.map((line) => ({
                    from: line.direction === "from_person" ? "customer" : "company",
                    text: line.text,
                    at: line.saidAt,
                })),
                brain: hits.map((hit) => ({ kind: hit.kind, truth: hit.truth, passage: hit.passage })),
            },
        })
        if (error) throw error
        // the team is told what to answer by hand: a model that gave no question falls back to what the lead wants
        return result.value.answered || result.value.question !== ""
            ? result.value
            : { ...result.value, question: input.summary.slice(0, 400) }
    }
}
