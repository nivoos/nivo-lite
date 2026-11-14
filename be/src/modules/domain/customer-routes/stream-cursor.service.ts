import { Inject, Injectable } from "@nestjs/common"
import type { CustomerLine } from "./customer-line-store.port"
import { STREAM_CURSOR_STORE, type StreamCursorStore } from "./stream-cursor-store.port"
import { newestHeardSeqOf, stepCallPrefixOf } from "./stream-cursor.policy"

@Injectable()
/**
 * THE STREAM CURSOR of the routes (rule QB-P5 C-4, owner defect O-R6-2): per route, the position of its stream (the lines of
 * public.customer_messages) that a run CONSUMED. A read of the stream inside a step of a run notes the newest person line it handed out as
 * the route's pending read, under the read's call key; when THAT STEP ENDS (the thread engine tells `stepEnded`), the pending read becomes the
 * cursor. A step that stops for a person consumes nothing: its re-run reads again. Readers take the person's lines after the cursor.
 */
export class StreamCursorService {
    constructor(@Inject(STREAM_CURSOR_STORE) private readonly store: StreamCursorStore) {}

    /** A step's call (`callKey`) read these lines of the route's stream: the newest person line among them becomes the pending read. */
    async read(workspaceId: string, routeId: string, callKey: string, lines: ReadonlyArray<CustomerLine>): Promise<void> {
        const newest = newestHeardSeqOf(lines)
        if (newest === null || callKey === "") return
        await this.store.noteRead(workspaceId, routeId, callKey, newest)
    }

    /** A step of a run ended (done, passed over, or ended unsuccessful): what it read of any stream is consumed. Answers how many routes moved. */
    stepEnded(workspaceId: string, runId: string, stepKey: string): Promise<number> {
        return this.store.consume(workspaceId, stepCallPrefixOf(runId, stepKey))
    }

    /** The route's cursor (bigint as text), or null while no run consumed it. */
    cursorOf(workspaceId: string, routeId: string): Promise<string | null> {
        return this.store.cursorOf(workspaceId, routeId)
    }
}
