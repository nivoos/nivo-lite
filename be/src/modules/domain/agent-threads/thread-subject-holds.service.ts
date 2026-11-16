import { Injectable, Optional, type OnModuleInit } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import {
    AgentGraphSubjectHoldsService,
    isInFlight,
    type HeldPerson,
    type PersonStop,
    type SubjectStopsPort,
} from "@modules/domain/agent-graphs"
import { AgentRunsService } from "@modules/domain/agent-runs"
import type { AgentWakeContext } from "@modules/domain/agent-work"
import { DeliveredWakesService } from "@modules/domain/provider-triggers/delivered-wakes.service"
import { InjectGraphThreads, type GraphThreads } from "@modules/integrations/langgraph"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { AgentThreadsLogEvent } from "./agent-threads.log-events"
import { heldEventsOf } from "./held-events.policy"
import { RunStopsService } from "./stops/run-stops.service"
import { RunStopRecordsService } from "./stops/run-stop-records.service"
import type { RunStop } from "./stops/run-stop.contracts"
import { ThreadRunsService } from "./thread-runs.service"
import { ThreadSweepService } from "./thread-sweep.service"

/** The most open stops about one person read (a bound, never a page of the workspace's stops: they are read by contact and by route). */
const PERSON_STOPS_MAX = 50

/** The most runs the sweep's backstop releases the held wakes of, per workspace and pass. */
const SWEEP_RUNS_MAX = 100

/** The most held wakes of one run read to count its waiting events (a bound; the count shown is then at least this). */
const HELD_COUNT_SCAN = 500

/** A person's open stop as the hold reads it. */
const personStopOf = (stop: RunStop): PersonStop => ({ runId: stop.runId, stepKey: stop.stepKey, since: stop.stoppedAt })

@Injectable()
/**
 * The thread runs' half of the ONE holding rule (QUEUE-BUILD rule Q-1, R71/R73; it replaces contact-freeze): (1) the open stops about a
 * person, which the graph flows read to hold an event behind a stopped run that told that person and to say what waits for a person of
 * the shop; (2) the release: when a run is FINISHED, every wake held behind it (`waiting:<run>`) is pending again, oldest first, so the
 * next run of the subject takes the whole list (a run that parks at a wait offers them to its wait first: `ThreadHandBacksService`); (3)
 * the sweep's backstop: a wake held behind a run that finished without its release (a crash between the two) is released on the next pass.
 */
export class ThreadSubjectHoldsService implements SubjectStopsPort, OnModuleInit {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectLogger() private readonly logger: Logger,
        private readonly stops: RunStopRecordsService,
        private readonly runs: AgentRunsService,
        private readonly wakes: DeliveredWakesService,
        @Optional() private readonly holds?: AgentGraphSubjectHoldsService,
        @Optional() private readonly threadRuns?: ThreadRunsService,
        @Optional() private readonly sweep?: ThreadSweepService,
        @Optional() private readonly runStops?: RunStopsService,
        @Optional() @InjectGraphThreads() private readonly threads?: GraphThreads,
    ) {}

    /** Registers with the graph flows' hold, the thread runs (after every drive) and the thread sweep (per workspace). */
    onModuleInit(): void {
        this.holds?.setStops(this)
        this.threadRuns?.whenSettled(async (ref) => {
            await this.released(ref.workspaceId, ref.runId)
        })
        this.sweep?.alsoPerWorkspace(async (workspaceId) => {
            await this.swept(workspaceId)
        })
    }

    /** The OPEN stops about a person (their contact, their route), oldest first, each once. */
    async openAbout(workspaceId: string, person: HeldPerson): Promise<ReadonlyArray<PersonStop>> {
        const ofContact = person.contactId === null ? [] : await this.stops.ofContacts(workspaceId, [person.contactId], "open", PERSON_STOPS_MAX)
        const ofRoute = person.routeId === null ? [] : await this.stops.ofRoutes(workspaceId, [person.routeId], "open", PERSON_STOPS_MAX)
        const seen = new Set<string>()
        return [...ofContact, ...ofRoute]
            .filter((stop) => (seen.has(stop.id) ? false : (seen.add(stop.id), true)))
            .sort((left, right) => left.stoppedAt.localeCompare(right.stoppedAt))
            .map(personStopOf)
    }

    /**
     * After a drive of a run: when the run is finished, the wakes held behind it are pending again (in one transaction); a run still in
     * flight keeps them. A failure is logged and left to the sweep; it never fails the drive. Answers how many it released.
     */
    async released(workspaceId: string, runId: string): Promise<number> {
        try {
            const run = await this.runs.runOf(workspaceId, runId)
            if (run !== null && isInFlight(run.status)) return 0
            const released = await this.entityManager.transaction((tx) => this.wakes.releaseWaiting(tx, workspaceId, runId))
            if (released > 0) this.logger.info(AgentThreadsLogEvent.HeldWakesReleased, { runId, released })
            return released
        } catch (cause) {
            this.logger.error(AgentThreadsLogEvent.HeldWakesReleaseFailed, cause, { runId })
            return 0
        }
    }

    /**
     * The sweep's backstop: the wakes held behind runs of the workspace that finished are released; answers how many. A run still in flight
     * has its open stops' waiting count brought up to date (ENGINE-FIN (a)): an event of a `stream` folded into a marker ALREADY held
     * behind the run begins no wake of its own, so the card shows it at the latest one sweep pass later (the debounce of that case).
     */
    async swept(workspaceId: string): Promise<number> {
        const runIds = await this.wakes.runsHeldBehind(this.entityManager, workspaceId, SWEEP_RUNS_MAX)
        let released = 0
        await eachInOrder(runIds, async (runId) => {
            const freed = await this.released(workspaceId, runId)
            released += freed
            if (freed === 0) await this.counted(workspaceId, runId, null)
        })
        return released
    }

    /** ENGINE-FIN (a): an event was just held behind the run (the flow's hold; its wake is written held right after): the count includes it. */
    async eventHeld(workspaceId: string, runId: string, held: AgentWakeContext): Promise<void> {
        await this.counted(workspaceId, runId, held)
    }

    /**
     * Tells the open stops of a run how many events of its subject wait behind it: the wakes held `waiting:<run>` by `heldEventsOf`, plus
     * the one being held now (not yet written held). Nothing for a run with no open stop. A failure is logged, never thrown: the hold stands.
     */
    private async counted(workspaceId: string, runId: string, adding: AgentWakeContext | null): Promise<void> {
        if (this.runStops === undefined) return
        try {
            const open = (await this.stops.ofRun(workspaceId, runId)).filter((stop) => stop.state === "open")
            if (open.length === 0) return
            const held = await this.wakes.heldBehind(this.entityManager, workspaceId, runId, HELD_COUNT_SCAN)
            const waiting = heldEventsOf([...held.map((wake) => wake.context), ...(adding === null ? [] : [adding])])
            const view = this.threads === undefined ? null : await this.threads.stateOf({ workspaceId, runId })
            const trigger: unknown = view?.state.trigger
            const locale = typeof trigger === "object" && trigger !== null && Reflect.get(trigger, "locale") === "en" ? "en" : "vi"
            await this.runStops.waitingCounted({ workspaceId, runId }, waiting, { locale })
        } catch (cause) {
            this.logger.error(AgentThreadsLogEvent.HeldCountFailed, cause, { runId })
        }
    }
}
