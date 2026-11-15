import { Injectable, Optional } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AgentRunsService, type RunSubject } from "@modules/domain/agent-runs"
import { AgentTasksService, timerSubjectKeyStartOf, type TimerSubject } from "@modules/domain/agent-work"
import { DeliveredWakesService, KEY_SCOPE_PREFIX } from "@modules/domain/provider-triggers"
import { InjectGraphThreads, type GraphThreads, type ThreadRef, type ThreadView } from "@modules/integrations/langgraph"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { AgentThreadsLogEvent } from "./agent-threads.log-events"
import { RunStopsService } from "./stops/run-stops.service"

/** The one typed terminal reason of a run ended because its subject was erased, and of the wakes held behind it. */
export const SUBJECT_ERASED = "subject_erased"

/** The subject paths of a person (`key:contactId=<id>`) and of one of their routes (`key:routeId=<id>`), as the delivery keys runs. */
const CONTACT_PATH = "contactId"
const ROUTE_PATH = "routeId"

/** The lock scope of the wakes of a subject: `key:<path>=<value>`, as the delivery writes it. */
const scopeKeyOf = (subject: RunSubject): string => `${KEY_SCOPE_PREFIX}${subject.kind}=${subject.id}`

/** Whom the timers of a subject are armed for: a person is a contact, a route is a conversation, any other subject is itself. */
const timerSubjectOf = (subject: RunSubject): TimerSubject => {
    if (subject.kind === CONTACT_PATH) return { contactId: subject.id, conversationId: null }
    if (subject.kind === ROUTE_PATH) return { contactId: null, conversationId: subject.id }
    return { contactId: null, conversationId: null, subject: { kind: subject.kind, id: subject.id } }
}

/** What the erasure of subjects ended: the runs parked on them, the wakes still waiting in their scopes, the timers armed for them. */
export interface ErasedSubjectWork {
    readonly runs: number
    readonly wakes: number
    readonly timers: number
    /** The runs it ended: their open stops close once the erasure committed (`stopsClosed`). */
    readonly runIds: ReadonlyArray<string>
}

/** The language of a thread's cards, read from its trigger as it began. */
const localeOf = (view: ThreadView | null): "vi" | "en" => {
    const trigger: unknown = view?.state.trigger
    return typeof trigger === "object" && trigger !== null && Reflect.get(trigger, "locale") === "en" ? "en" : "vi"
}

@Injectable()
/**
 * THE END OF EVERYTHING PENDING FOR AN ERASED SUBJECT (coordinator rulings R37 and R72 Q1 on owner ruling R31): when a subject is erased
 * (a contact deleted, and with it every route it holds), no event of it will come again (the person writing again is a NEW contact on a
 * NEW route), so nothing pending for it may run or fire. In the caller's transaction, ONE function ends: (1) every thread run of any agent
 * parked on one of the subjects, with the typed reason `subject_erased` (its wait mark and deadline cleared, its open step rows closed),
 * and the wakes held behind it (`waiting:<run>`); (2) every wake of any agent still waiting to run in the subjects' lock scopes (pending,
 * or held behind a run or by the hours), `skipped` `subject_erased`; (3) every timer armed for the subjects (a person's or a conversation's
 * timer task: `dropped`, never fired by the sweep; a timer takes its run's subject on every road, so one armed after a Retry is found too).
 * Once the erasure committed, (4) the open stops of the runs it ended close with them (`stopsClosed`). The re-offer door (`DeliveredWakesService`) moves the wakes. One log line per ended
 * run and one for the whole erasure. No stop card is raised and nobody is told (the person asked to be forgotten). Generic: it knows
 * subjects (kind + id) and the engine's own timer keys, never what a contact or a chat is.
 */
export class ErasedSubjectRunsService {
    constructor(
        private readonly runs: AgentRunsService,
        private readonly wakes: DeliveredWakesService,
        @Optional() private readonly tasks?: AgentTasksService,
        @Optional() @InjectLogger() private readonly logger?: Logger,
        @Optional() private readonly stops?: RunStopsService,
        @Optional() @InjectGraphThreads() private readonly port?: GraphThreads,
    ) {}

    /** Ends everything pending for the subjects, in `tx`; answers the runs it ended (their stops close after the commit: `stopsClosed`). */
    async ended(tx: EntityManager, workspaceId: string, subjects: ReadonlyArray<RunSubject>): Promise<ReadonlyArray<string>> {
        return (await this.endedAll(tx, workspaceId, subjects)).runIds
    }

    /**
     * D3-W3-9: the open stops of the runs an erasure ended close WITH their run (the one rule `RunStopsService.runClosed` keeps for every
     * run the engine closes: the stop resolves, its card is rewritten resolved with no live button, the owner's item it waits on is
     * withdrawn). Called once the erasure committed, never inside it: the card and the item are writes of their own (a team-chat post,
     * a work item) and the item's withdrawal patches the stop row the erasure would still hold. A crash before this runs leaves the stop
     * to the thread sweep, which closes every open stop of a closed run by the same function. Answers how many stops it closed.
     */
    async stopsClosed(workspaceId: string, runIds: ReadonlyArray<string>): Promise<number> {
        if (this.stops === undefined) return 0
        let closed = 0
        await eachInOrder(runIds, async (runId) => {
            const ref: ThreadRef = { workspaceId, runId }
            try {
                const view = (await this.port?.stateOf(ref)) ?? null
                closed += (await this.stops?.runClosed(ref, { locale: localeOf(view) })) ?? 0
            } catch (cause) {
                // The erasure stands; the sweep closes an open stop of a closed run on its next pass.
                this.logger?.error(AgentThreadsLogEvent.SubjectErasedStopsLeft, cause, { runId })
            }
        })
        return closed
    }

    /** Ends everything pending for the subjects, in `tx`: the parked runs (and the wakes held behind them), the waiting wakes, the timers. */
    async endedAll(tx: EntityManager, workspaceId: string, subjects: ReadonlyArray<RunSubject>): Promise<ErasedSubjectWork> {
        if (subjects.length === 0) return { runs: 0, wakes: 0, timers: 0, runIds: [] }
        const ended = await this.runs.endInFlightOfSubjects(tx, workspaceId, subjects, SUBJECT_ERASED)
        let wakes = 0
        await eachInOrder(ended, async (run) => {
            const dropped = await this.wakes.dropWaiting(tx, workspaceId, run.id, SUBJECT_ERASED)
            wakes += dropped
            this.logger?.info(AgentThreadsLogEvent.SubjectErasedRunEnded, { runId: run.id, agentId: run.agentId, dropped })
        })
        wakes += await this.wakes.dropOfScopes(tx, workspaceId, subjects.map(scopeKeyOf), SUBJECT_ERASED)
        const starts = subjects.flatMap((subject) => {
            const start = timerSubjectKeyStartOf(timerSubjectOf(subject))
            return start === null ? [] : [start]
        })
        const timers = this.tasks === undefined ? 0 : await this.tasks.dropOfKeyStarts(tx, workspaceId, starts)
        this.logger?.info(AgentThreadsLogEvent.SubjectErasedWorkEnded, { workspaceId, runs: ended.length, wakes, timers })
        return { runs: ended.length, wakes, timers, runIds: ended.map((run) => run.id) }
    }
}
