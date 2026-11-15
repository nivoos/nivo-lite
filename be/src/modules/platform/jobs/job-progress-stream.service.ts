import { Injectable, Optional, type MessageEvent } from "@nestjs/common"
import { Observable } from "rxjs"
import { In, Like, MoreThanOrEqual, type EntityManager } from "typeorm"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectRealtimeHub, type RealtimeHub } from "@modules/platform/realtime"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import { InjectJobsManagers } from "./jobs.decorators"
import {
    frameOfRow,
    isJobProgressFrame,
    JOB_PROGRESS_RECENT_HOURS,
    jobProgressChainsLike,
    jobProgressRootsOf,
    jobProgressTopic,
    jobProgressTopicName,
    type JobProgressFrame,
    type JobProgressScope,
} from "./job-progress.policy"
import { JobEntity } from "./persistence/entities"

/** The most job rows one subscription's current state reads (the latest row of each chain and job name is kept). */
const ROW_LIMIT = 500

const HOUR_MS = 3_600_000


@Injectable()
/**
 * The progress of a workspace's chains as server-sent events, for one chain, a bounded list of chains or the whole workspace: FIRST the
 * current state (the latest row of each chain and job name, read from the job rows: the stream is a view of them; a whole workspace
 * reads only the rows changed in the last day), THEN the live frames of the workspace's ONE hub topic after the `Last-Event-ID`,
 * filtered on the server to the asked roots. The hub
 * subscription opens before the rows are read and its frames wait behind them, so a change that lands in between is not lost; a
 * frame the snapshot already shows is repeated at worst, and the client keeps the newest by `at`. A snapshot event repeats the
 * `Last-Event-ID` the client sent (empty when it sent none, which Nest would otherwise number itself), so a snapshot never moves the
 * client's resume point: it stays the last live frame's. Who may read the topic is the caller's to decide before it opens the stream.
 */
export class JobProgressStreamService {
    constructor(
        @InjectJobsManagers() private readonly managers: ReadonlyArray<EntityManager>,
        @InjectClock() private readonly clock: Clock,
        @Optional() @InjectRealtimeHub() private readonly hub?: RealtimeHub,
    ) {}

    /** The current state of every job of the scope, one frame per chain and job name, the oldest first. */
    async current(scope: JobProgressScope): Promise<Array<JobProgressFrame>> {
        const [manager] = this.managers
        if (manager === undefined) throw new JobsError({ code: JobsErrorCode.ConnectionMissing })
        const roots = jobProgressRootsOf(scope)
        const rows = await manager.find(JobEntity, {
            select: {
                id: true,
                kind: true,
                status: true,
                failureClass: true,
                progressTopic: true,
                progressDone: true,
                progressTotal: true,
                progressLabel: true,
                progressAt: true,
                progressRetryAt: true,
                error: true,
                updatedAt: true,
            },
            where:
                roots.length === 0
                    ? {
                          progressTopic: Like(jobProgressChainsLike(scope.workspaceId)),
                          updatedAt: MoreThanOrEqual(new Date(this.clock.now().getTime() - JOB_PROGRESS_RECENT_HOURS * HOUR_MS)),
                      }
                    : {
                          progressTopic: In(roots.map((root) => jobProgressTopicName({ workspaceId: scope.workspaceId, root }))),
                      },
            order: { updatedAt: "DESC" },
            take: ROW_LIMIT,
        })
        const latest = new Map<string, JobProgressFrame>()
        for (const row of rows) {
            const key = `${row.progressTopic ?? ""}|${row.kind}`
            if (latest.has(key)) continue
            const frame = frameOfRow(row)
            if (frame !== undefined) latest.set(key, frame)
        }
        return [...latest.values()].reverse()
    }

    /** Opens the stream: the current state first, then the live frames of the scope after `after`. */
    open(scope: JobProgressScope, after?: string): Observable<MessageEvent> {
        const roots = jobProgressRootsOf(scope)
        const asked = roots.length === 0 ? undefined : new Set(roots)
        const wanted = (event: MessageEvent): boolean =>
            asked === undefined || !isJobProgressFrame(event.data) || asked.has(event.data.root)
        return new Observable<MessageEvent>((subscriber) => {
            const waiting: Array<MessageEvent> = []
            let snapshotSent = false
            const live = this.hub?.stream(jobProgressTopic(scope.workspaceId), { after }).subscribe({
                next: (event) => {
                    if (!wanted(event)) return
                    if (snapshotSent) subscriber.next(event)
                    else waiting.push(event)
                },
                error: (cause: unknown) => subscriber.error(cause),
                complete: () => subscriber.complete(),
            })
            void this.current(scope).then(
                (frames) => {
                    for (const frame of frames) subscriber.next({ id: after ?? "", data: frame })
                    snapshotSent = true
                    for (const event of waiting.splice(0)) subscriber.next(event)
                    if (live === undefined) subscriber.complete()
                },
                (cause: unknown) => subscriber.error(cause),
            )
            return () => live?.unsubscribe()
        })
    }
}
