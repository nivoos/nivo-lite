import { Injectable } from "@nestjs/common"
import type { NodeTurn, NodeWorkspacePolicies } from "@modules/domain/graph-nodes"
import { ToolsError, ToolsErrorCode } from "@modules/domain/tools"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { BrainNativeService } from "./brain-native.service"

/**
 * How long one read serves every step of the same agent and lens: the provider's prompt-cache window (Anthropic's default entry,
 * 5 minutes). Every step within it sees the same policies, so its L2 bytes are the ones the cache holds; a changed policy shows once, at
 * the next window.
 */
export const POLICY_PREREAD_WINDOW_MS = 5 * 60 * 1000

/** The page the engine asks: the tool's own upper bound (L2 then bounds what it lays out and counts the rest). */
const POLICY_PREREAD_ARGS = { limit: 200 } as const

/** One read held: when it was made and what it came to. */
interface HeldRead {
    readonly at: number
    readonly answer: Promise<unknown>
}

@Injectable()
/**
 * The engine's pre-read of the workspace's policies for a turn's agent (graph-nodes `NodeWorkspacePolicies`, L2 of its model calls): the
 * brain tool `nivo.tool.brain.policy.list` itself (`BrainNativeService`), asked as the turn's agent in a workflow step with the turn's
 * conversation, so the lens is exactly the one the step's own call of that tool reads through (one tool, one view, no second reader). It is
 * the engine's read, not a call of the step: it takes no turn and no tool call of the step's budget. One read per workspace, agent and
 * audience (a conversation narrows to the customer's) serves every step for `POLICY_PREREAD_WINDOW_MS`.
 */
export class BrainPolicyPreReadService implements NodeWorkspacePolicies {
    /** The reads held, for the window. */
    private readonly held = new Map<string, HeldRead>()

    constructor(
        private readonly brain: BrainNativeService,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /** What `nivo.tool.brain.policy.list` answers for the turn's agent, read at most once per window. */
    policiesOf(turn: NodeTurn): Promise<unknown> {
        const key = [turn.workspaceId, turn.agentId, turn.conversationId === null ? "agent" : "conversation"].join("|")
        const now = this.clock.now().getTime()
        const kept = this.held.get(key)
        if (kept !== undefined && now - kept.at < POLICY_PREREAD_WINDOW_MS) return kept.answer
        for (const [heldKey, read] of this.held) if (now - read.at >= POLICY_PREREAD_WINDOW_MS) this.held.delete(heldKey)
        const answer = this.brain
            .invoke(turn.workspaceId, "policy.list", POLICY_PREREAD_ARGS, {
                agentId: turn.agentId,
                conversationId: turn.conversationId,
                graphStep: true,
            })
            // The tool's own refusal (the agent reads nothing here) is its answer, as a step's call would read it: no policy, no L2.
            .catch((cause: unknown) => {
                if (cause instanceof ToolsError && cause.code === ToolsErrorCode.NativeRefused)
                    return { ok: false, refusal: String(cause.params?.reason ?? "refused"), facts: {} }
                throw cause
            })
        this.held.set(key, { at: now, answer })
        // A failed read is not held: the next step reads again.
        answer.catch(() => this.held.delete(key))
        return answer
    }
}
