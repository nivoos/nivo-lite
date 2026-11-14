import { Injectable, type MessageEvent } from "@nestjs/common"
import { defer, from, switchMap, type Observable } from "rxjs"
import { WorkspaceMembersService } from "@modules/domain/workspace-members"
import type { Principal } from "@modules/platform/cqrs"
import { InjectJobProgressStream, type JobProgressStreamService } from "@modules/platform/jobs"

/** What a caller asks to follow: one chain root, a bounded list of roots, or neither for the whole workspace. */
export interface JobProgressAsk {
    /** One chain root `<kind>:<id>`. */
    readonly root?: string | undefined
    /** Several chain roots, comma-separated as the query carries them (the stream bounds and checks the list). */
    readonly roots?: string | undefined
}

@Injectable()
/**
 * The one read a job-progress door makes: the workspace is the principal of the topic, so the caller must be an active member of it
 * before anything is read (BE-REALTIME-3); then the platform stream answers the current state of the asked chains from the rows and
 * the live frames after it (a `Last-Event-ID` resumes inside that topic). The door stays one call.
 */
export class JobProgressAccessService {
    constructor(
        private readonly members: WorkspaceMembersService,
        @InjectJobProgressStream() private readonly progress: JobProgressStreamService,
    ) {}

    /** Opens the progress stream of the workspace for a member; a non-member is refused before any read. */
    open(principal: Principal, workspaceId: string, ask: JobProgressAsk, lastEventId?: string): Observable<MessageEvent> {
        return defer(() =>
            from(this.members.require(principal.id, workspaceId)).pipe(
                switchMap(() => this.progress.open({ workspaceId, root: ask.root, roots: ask.roots }, lastEventId)),
            ),
        )
    }
}
