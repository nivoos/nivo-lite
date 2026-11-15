import { Inject, Injectable } from "@nestjs/common"
import type { CustomerLine } from "./customer-line-store.port"
import { STREAM_CURSOR_STORE, type StreamCursorStore, type StreamRef } from "./stream-cursor-store.port"
import { LINES_STREAM, newestHeardSeqOf, stepCallPrefixOf } from "./stream-cursor.policy"

@Injectable()
/**
 * THE STREAM CURSOR of every engine stream (concept agent-data rules 5, 8, 9; customer-messages rule 19): per (consumer agent, stream,
 * subject), the position a step of the agent CONSUMED. A consuming read inside a step notes the newest item it handed out as the pending
 * read, under the read's call key; when THAT STEP ENDS (the thread engine tells `stepEnded`) the pending read becomes the cursor. A step that
 * stops for a person consumes nothing: its re-run reads again. Readers take the items after the cursor. The consumer is the AGENT: another
 * agent reading the same subject keeps its own position (reads are open across agents).
 */
export class StreamCursorService {
    constructor(@Inject(STREAM_CURSOR_STORE) private readonly store: StreamCursorStore) {}

    /** A step's call (`callKey`) of the agent read these lines of the route: the newest PERSON line among them becomes the pending read. */
    async readLines(workspaceId: string, agentId: string, routeId: string, callKey: string, lines: ReadonlyArray<CustomerLine>): Promise<void> {
        const newest = newestHeardSeqOf(lines)
        if (newest === null) return
        await this.read(workspaceId, { agentId, stream: LINES_STREAM, subject: routeId }, callKey, newest)
    }

    /** A step's call (`callKey`) read a stream subject up to `seq`: the pending read of the consumer on that subject. */
    async read(workspaceId: string, ref: StreamRef, callKey: string, seq: string): Promise<void> {
        if (callKey === "" || seq === "") return
        await this.store.noteRead(workspaceId, ref, callKey, seq)
    }

    /** A step of a run ended (done, passed over, or ended unsuccessful): what it read of any stream is consumed. Answers how many cursors moved. */
    stepEnded(workspaceId: string, runId: string, stepKey: string): Promise<number> {
        return this.store.consume(workspaceId, stepCallPrefixOf(runId, stepKey))
    }

    /** The consumer's cursor (bigint as text), or null while it consumed none. */
    cursorOf(workspaceId: string, ref: StreamRef): Promise<string | null> {
        return this.store.cursorOf(workspaceId, ref)
    }

    /** Two subjects became one (a contact merged into another): every consumer's position on `from` joins its position on `into`. */
    merged(workspaceId: string, from: string, into: string): Promise<number> {
        return this.store.merge(workspaceId, from, into)
    }
}
