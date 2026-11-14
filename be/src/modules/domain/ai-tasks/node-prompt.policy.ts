import type { CallMeta, ChatMessage, NodeAsk } from "./ai-tasks.contracts"
import type { TaskSchema } from "./ai-tasks.schema"

/**
 * The JSON Schema of the answer a structured node call parses, as the model reads it: the members the zod schema accepts, with their
 * names, types and enum values. JSON mode alone tells the model only "an object", so without it the model guesses the member names.
 */
const answerSchemaOf = (schema: TaskSchema): string =>
    JSON.stringify(schema.toJSONSchema({ io: "input", unrepresentable: "any" }))

/** The system message of a node's call: its instructions, followed by the JSON Schema its answer must match when it asks for JSON. */
const instructionsOf = (ask: NodeAsk, schema: TaskSchema | null): string =>
    schema === null
        ? ask.instructions
        : `${ask.instructions}\n\nAnswer with one JSON object that matches this JSON Schema exactly (member names, types and allowed values):\n${answerSchemaOf(schema)}`

/**
 * The two parts of a graph node's call, for the provider's prompt cache. `stable` is the prefix a provider caches, in the layers of
 * agent-sdk's "layout of a model call": L1 the agent's craft and tool set, L2 the workspace's policies, L3 the step's own words with the answer's
 * JSON Schema for a structured call; each the same text, byte for byte, for the same agent (L1), workspace (L2) and step (L3). `volatile` is
 * what changes from call to call: the words that hold for this call only, the input as JSON (with the pictures), then each earlier turn
 * of a loop as its own part, so a later turn only appends.
 */
export interface NodePrompt {
    /** The stable part: one marked system message per non-empty layer, L1, L2, L3 in that order. THE END OF THE STABLE PART is its end. */
    readonly stable: ReadonlyArray<ChatMessage>
    /** The volatile part, sent after the stable one. */
    readonly volatile: ReadonlyArray<ChatMessage>
}

/**
 * The stable part as system messages, each marked for the prompt cache at its layer's end: L1 and L2 from the call's opening (a layer
 * with no text is no message and no mark), then L3. At most three marks: with the automatic one, Anthropic's four.
 */
const stableOf = (ask: NodeAsk, schema: TaskSchema | null): ReadonlyArray<ChatMessage> => {
    const shared = [ask.opening?.craft ?? "", ask.opening?.policies ?? ""].filter((layer) => layer !== "")
    return [...shared, instructionsOf(ask, schema)].map((content) => ({ role: "system", content, cacheMark: true }))
}

/**
 * A graph node's call laid out stable part first. A model that takes cache markers gets a marker at the end of each stable layer and
 * nowhere else; the automatic breakpoint at the end of the request covers the volatile part, which a loop's next turn only extends.
 */
export const nodePromptOf = (ask: NodeAsk, schema: TaskSchema | null = null): NodePrompt => {
    const words = (ask.volatile ?? "").trim()
    return {
        stable: stableOf(ask, schema),
        volatile: [
            ...(words === "" ? [] : [{ role: "system" as const, content: words }]),
            {
                role: "user",
                content: JSON.stringify(ask.input ?? null),
                ...(ask.images === undefined || ask.images.length === 0 ? {} : { images: ask.images }),
            },
            ...(ask.turns ?? []).map((turn): ChatMessage => ({ role: "user", content: JSON.stringify(turn) })),
        ],
    }
}

/** The messages of a graph node's call: the stable part (instructions, answer schema), then the volatile one (this call's words, the input as JSON). */
export const nodeMessagesOf = (ask: NodeAsk, schema: TaskSchema | null = null): ReadonlyArray<ChatMessage> => {
    const prompt = nodePromptOf(ask, schema)
    return [...prompt.stable, ...prompt.volatile]
}

/** How a graph node's call is metered: engine work of the namespace its purpose starts with (`order` of `order.record:extract`). */
export const nodeMetaOf = (ask: NodeAsk): CallMeta => ({ kind: "engine", module: ask.purpose.split(".", 1).join("") })
