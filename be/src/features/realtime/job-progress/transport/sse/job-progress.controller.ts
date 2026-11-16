import { Controller, Headers, Query, Sse, type MessageEvent } from "@nestjs/common"
import type { Observable } from "rxjs"
import { CurrentPrincipal } from "@modules/domain/identity"
import { JobProgressAccessService } from "@modules/domain/job-ops"
import { WorkspaceId } from "@modules/domain/workspace-members"
import type { Principal } from "@modules/platform/cqrs"
import { JobProgressStreamQuery } from "./job-progress.query"

@Controller("realtime/job-progress")
/** The one push door of the progress of every job: it opens the stream of the caller's workspace and chains and writes nothing. */
export class JobProgressController {
    constructor(private readonly progress: JobProgressAccessService) {}

    /**
     * The progress of the chains of the selected workspace, as server-sent events: first the current state of each job of the asked
     * chains read from its row (one `root`, a `roots` list, or neither for the whole workspace), then the live frames, each carrying
     * its `root`. The workspace is the principal of the topic: only an active member of it may open the stream (a non-member is
     * refused before anything is read); a `Last-Event-ID` header only resumes inside that topic.
     */
    @Sse()
    stream(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Query() query: JobProgressStreamQuery,
        @Headers("last-event-id") lastEventId?: string,
    ): Observable<MessageEvent> {
        return this.progress.open(principal, workspaceId, { root: query.root, roots: query.roots }, lastEventId)
    }
}
