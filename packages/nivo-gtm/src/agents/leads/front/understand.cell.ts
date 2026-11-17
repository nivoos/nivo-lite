import { z } from "zod"
import type { ContactConversationMessages, ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { TelegramMessage } from "@starci/nivoos-provider-templates/telegram/telegram.provider.cell"
import { keyOf } from "../../../package-key.ts"
import { LEADS_POLICY } from "../common/leads.guidance.ts"

export const UnderstandInput = z.strictObject({
    messages: z.array(TelegramMessage).min(1).max(50),
    /** Where the lead stands and what the team is waiting for from them: a pick of a demo time reads in that light. */
    stage: z.string().max(30),
    nextAction: z.string().max(300),
})
/** What the lead wants NOW, one of eight. */
export const LeadIntent = z.enum(["question", "interested", "wants_demo", "asks_price", "picks_slot", "customer_support", "not_fit", "spam"])
export const UnderstandOutput = z.strictObject({ intent: LeadIntent, summary: z.string().min(1).max(300), email: z.string().max(200) })
/** How many lines of the conversation the reading takes. A workspace may change it in the console. */
export const UnderstandSettings = z.strictObject({ threadLines: z.number().int().min(1).max(50).default(10) })

type In = z.infer<typeof UnderstandInput>
type Out = z.infer<typeof UnderstandOutput>
type Settings = z.infer<typeof UnderstandSettings>

const GOAL =
    "You read the new messages of a person who talks to NIVO's sales bot (`messages`, oldest first; `thread` is the recent conversation, oldest first; `stage` and `nextAction` say where " +
    "the team has this lead and what it waits for). Decide what they want NOW and answer `intent`, exactly one of: " +
    "question (asks something about NIVO or says hello); interested (shows interest in using NIVO without asking for a demo or a price); wants_demo (asks to see a demo, a trial or to talk to a person); " +
    "asks_price (asks what it costs or what the plans are); picks_slot (the team invited them to choose a demo time, `nextAction` says it waits for that, and they answer with a day or a time); " +
    "customer_support (they already use NIVO and need help with it); not_fit (what they want is not something NIVO does); spam (an advertisement, a link dump, noise). " +
    "When a message raises several things choose the one that moves the sale: picks_slot before wants_demo before asks_price before interested before question. " +
    "Write `summary`: one line in Vietnamese for the team, what they want, in their own terms. Set `email` to an email address they wrote in these messages, else an empty string."

/**
 * `nivo-gtm.leads-understand` (Hiểu ý khách): the decision of the front door. It reads the conversation's recent lines, then ONE generation answers one of eight intents with one line for
 * the team and the email the person gave, if any. The workflow routes on `intent` (structured data), never on the words. A model that cannot answer is the engine's to stop and retry.
 */
export class Understand implements Node<typeof UnderstandInput, typeof UnderstandOutput, typeof UnderstandSettings> {
    readonly key = keyOf("leads-understand")
    readonly version = 3
    readonly title = { vi: "Hiểu ý khách", en: "Understand the lead" }
    readonly input = UnderstandInput
    readonly output = UnderstandOutput
    readonly settings = UnderstandSettings
    readonly reads = ["contact_conversation.messages"]
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "fast" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        const thread = reach.call<ContactConversationMessages>("contact_conversation.messages", { limit: reach.settings.threadLines }).result.messages
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${LEADS_POLICY}\n\n${GOAL}`,
            data: {
                messages: input.messages.map((message) => ({ text: message.text, at: message.sentAt })),
                thread: thread.map((line) => ({ from: line.direction === "from_person" ? "customer" : "company", text: line.text, at: line.saidAt })),
                stage: input.stage,
                nextAction: input.nextAction,
            },
        })
        if (error) throw error
        return result.value
    }
}
