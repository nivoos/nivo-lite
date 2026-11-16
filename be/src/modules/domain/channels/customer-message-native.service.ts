import { Injectable, Optional } from "@nestjs/common"
import { CONTEXT_NOTICE } from "@modules/domain/context-sources"
import { CustomerMessagesService, LINES_STREAM, StreamCursorService, type CustomerLine } from "@modules/domain/customer-routes"
import { nativeRefusal } from "@modules/domain/native-tools/native-refusal.policy"
import {
    argumentsOf,
    unknownTool,
    type NativeCaller,
    type NativeToolFamily,
    type ToolJson,
    type ToolManifest,
} from "@modules/domain/tools"
import { InjectClock, type Clock } from "@modules/platform/clock"
import {
    CONVERSATION_MESSAGE_LIST_INPUT_SCHEMA,
    CONVERSATION_MESSAGE_LIST_SCHEMA,
    THREAD_LIST_DEFAULT,
    THREAD_TEXT_MAX,
} from "./customer-message-native.schema"

/** The tool of the connector, by its own name (`nivo.tool.conversation.message.list`). */
export const CONVERSATION_MESSAGE_TOOL = { list: "list" } as const

/** The source name the thread read answers under (the one result shape of a context read). */
export const CONVERSATION_SOURCE = "nivo.conversation"

/** The native connector of the conversation with the customer of a route: the engine's own lines, both directions, read-only. */
export const CONVERSATION_MESSAGE_MANIFEST: ToolManifest = {
    key: "conversation-messages",
    namespace: "nivo.tool.conversation.message",
    name: "Conversation messages",
    contractVersion: "conversation-messages@1",
    tools: [
        {
            name: CONVERSATION_MESSAGE_TOOL.list,
            description:
                "The latest lines of the conversation with the customer this run serves, newest first, both directions: what the customer said and what was told to them (by any agent or a person of the shop, delivered only), with when and who. Takes no conversation id; `since` (ISO) reads only the lines said from then on. Each line has its position (`seq`) and the answer names `consumedSeq`, the position runs already handled (null: none yet): what the customer said that is still unread is their lines after it. `consume: true` takes the unread lines as this step's to handle (they count as handled once the step ends).",
            scope: "read",
            defaultMode: "auto",
            inputSchema: CONVERSATION_MESSAGE_LIST_INPUT_SCHEMA,
            argumentSchema: CONVERSATION_MESSAGE_LIST_SCHEMA,
            secretFields: ["facts"],
        },
    ],
}

/**
 * One line as the model reads it. `role` is the line's direction in the words the thread readers already compare (`user` = the
 * customer, `agent` = the shop: any agent or a person), never read from the text.
 */
const factOf = (line: CustomerLine): ToolJson => ({
    // The line's position in the route's stream (its insertion order, decimal text): compared with `consumedSeq` by a reader.
    seq: line.seq,
    role: line.direction === "from_person" ? "user" : "agent",
    direction: line.direction,
    text: line.text.slice(0, THREAD_TEXT_MAX),
    at: line.saidAt,
    ...(line.files.length === 0
        ? {}
        : {
              files: line.files.map((file) =>
                  file.url === null
                      ? {
                            url: null,
                            notKept: file.notKept ?? null,
                            contentType: file.contentType,
                            // A part with no file (a link, a contact, a place) IS its content: what the channel sent of it.
                            ...(file.name === "" ? {} : { name: file.name }),
                        }
                      : { url: file.url, contentType: file.contentType },
              ),
          }),
    agentId: line.agentId,
    memberId: line.memberId,
})

@Injectable()
/**
 * THE thread read of every agent (`nivo.tool.conversation.message.list`, owner ruling R26): the engine's own lines of the run's ROUTE, both
 * directions, newest first, bounded (a limit with a hard cap, a bounded text). What was told counts only once delivered (a claimed,
 * refused or unknown send was not told). Engine data only: no plugin serves it and no chatbot needs to be installed. The route is the
 * caller's (the door fills it from the run token); naming another is refused (`other_conversation`) before anything is read, and a run
 * with no route reads no line.
 */
export class CustomerMessageNativeService implements NativeToolFamily {
    readonly manifest: ToolManifest = CONVERSATION_MESSAGE_MANIFEST

    constructor(
        private readonly lines: CustomerMessagesService,
        @InjectClock() private readonly clock: Clock,
        @Optional() private readonly cursor?: StreamCursorService,
    ) {}

    /** Runs the one tool of the connector. */
    async invoke(workspaceId: string, tool: string, args: ToolJson, caller: NativeCaller): Promise<ToolJson> {
        if (tool !== CONVERSATION_MESSAGE_TOOL.list) throw unknownTool(tool)
        const asked = argumentsOf(tool, CONVERSATION_MESSAGE_LIST_SCHEMA, args)
        const routeId = caller.conversationId
        if (asked.conversationId !== undefined && asked.conversationId !== routeId) throw nativeRefusal("other_conversation")
        const rows =
            routeId === null
                ? []
                : (await this.lines.threadOf(workspaceId, routeId, {
                      limit: asked.limit ?? THREAD_LIST_DEFAULT,
                      told: "delivered",
                      ...(asked.since === undefined ? {} : { since: asked.since }),
                  })).rows
        // THE STREAM CURSOR (rule QB-P5 C-4): the answer names what runs consumed of the route (`consumedSeq`, null while none did), and a
        // CONSUMING read (`consume: true`) made by a step of a run is that step's pending read until the step ends (the call key names the
        // run and the step); a read for context consumes nothing.
        // The CALLER AGENT's position (concept agent-data rule 8: the consumer is the agent; another agent reading the route keeps its own).
        const ref = routeId === null ? null : { agentId: caller.agentId, stream: LINES_STREAM, subject: routeId }
        const consumedSeq = ref === null || this.cursor === undefined ? null : await this.cursor.cursorOf(workspaceId, ref)
        if (routeId !== null && asked.consume === true && caller.graphStep === true && caller.opKey !== undefined)
            await this.cursor?.readLines(workspaceId, caller.agentId, routeId, caller.opKey, rows)
        return {
            notice: CONTEXT_NOTICE,
            source: CONVERSATION_SOURCE,
            asOf: this.clock.now().toISOString(),
            consumedSeq,
            facts: rows.map((line) => factOf(line)),
        }
    }
}
