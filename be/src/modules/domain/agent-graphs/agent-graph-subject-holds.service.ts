import { Injectable, Optional } from "@nestjs/common"
import { AgentRunsService, type RunSubject, type SubjectHolder } from "@modules/domain/agent-runs"
import type { AgentWakeContext } from "@modules/domain/agent-work"
// The service file, not the barrel: the barrel loads contacts-page.service, which reaches agent-work while it is half loaded (R37).
import { ContactsService } from "@modules/domain/contacts/contacts.service"

/** The person an event is about, as the engine met it: their contact and the route they came in on (either may be absent). */
export interface HeldPerson {
    readonly contactId: string | null
    readonly routeId: string | null
}

/** One OPEN stop that is about a person: the run it stopped, its step and since when (ISO text). */
export interface PersonStop {
    readonly runId: string
    readonly stepKey: string
    readonly since: string
}

/** One thing of a person that waits for a person of the shop: the step its run stopped on, and since when. */
export interface FlowWaiting {
    /** The step the run stopped on. */
    readonly step: string
    /** When it stopped, ISO text. */
    readonly since: string
}

/**
 * The open stops about a person, as the thread runs keep them: registered by the capability that keeps the stops when its module starts,
 * so this module never imports it (the thread runs reach the graph flows).
 */
export interface SubjectStopsPort {
    /** The OPEN stops about the person (their contact and the ids merged into it, or their route), oldest first. */
    openAbout(workspaceId: string, person: HeldPerson): Promise<ReadonlyArray<PersonStop>>
    /**
     * ENGINE-FIN (a): an event of the run's subject was just held behind the run (`waiting:<run>`; `held` = the wake's ids-only context,
     * which says how many events it stands for): the open stops of that run show how many events now wait. Never throws.
     */
    eventHeld(workspaceId: string, runId: string, held: AgentWakeContext): Promise<void>
}

/** The subject kind of a person (the scope member `contactId`): the one kind whose ids a merge joins. */
const PERSON_SUBJECT = "contactId"

/** A run that holds an event's subject: its id and its workflow. */
export type HoldingRun = Pick<SubjectHolder, "id" | "workflowId">

@Injectable()
/**
 * THE ONE HOLDING RULE (QUEUE-BUILD rule Q-1, R71/R73): a run that is not finished keeps its subject for every workflow. An event is
 * held behind the OLDEST such run when (a) that run's subject is one the event's scope names (its own key, its route, its contact), or
 * (b) that run has an OPEN stop about the event's person (the person it told, or a merged id of them). An event that names no subject
 * and no person is never held. Engine words only: which member of a trigger's scope is a subject is the trigger's declaration
 * (`subjectOfScope` of its lock scope; the route and the contact the pipeline met).
 */
export class AgentGraphSubjectHoldsService {
    private stops: SubjectStopsPort | undefined = undefined

    constructor(
        private readonly runs: AgentRunsService,
        // A person's subject covers every id merged into them (concept agent-data, contact operations); absent in an app with no contacts.
        @Optional() private readonly contacts?: ContactsService,
    ) {}

    /** Registers the open stops of the thread runs: one capability keeps them, the last registration is the one asked. */
    setStops(port: SubjectStopsPort): void {
        this.stops = port
    }

    /**
     * The run that holds an event, or null: the oldest run in flight whose subject is one of `subjects`, else the run of the oldest open stop
     * about `person` that is still in flight. `skipped` runs never hold it (the event's own run on a replay, a run that handed it back).
     */
    async holderOf(
        workspaceId: string,
        subjects: ReadonlyArray<RunSubject>,
        person: HeldPerson,
        skipped: ReadonlySet<string>,
    ): Promise<HoldingRun | null> {
        const bySubject: Array<SubjectHolder> = []
        for (const subject of await this.mergedOf(workspaceId, subjects))
            bySubject.push(...(await this.runs.inFlightOfSubject(workspaceId, subject)))
        const [oldest] = bySubject
            .filter((run) => !skipped.has(run.id))
            .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id))
        if (oldest !== undefined) return { id: oldest.id, workflowId: oldest.workflowId }
        for (const stop of await this.openAbout(workspaceId, person)) {
            if (skipped.has(stop.runId)) continue
            const run = await this.runs.runOf(workspaceId, stop.runId)
            if (run !== null && isInFlight(run.status)) {
                const workflowId: unknown = run.context.workflowId
                return { id: run.id, workflowId: typeof workflowId === "string" ? workflowId : null }
            }
        }
        return null
    }

    /**
     * The subjects with every PERSON subject widened to the person and every id merged into them (concept agent-data, "Contact and subject":
     * a merge joins two ids into one person, and a run keyed by either id holds an event keyed by the other, whatever the data source of the
     * event: a person's line, a call, a record keyed by a contact field). Any other subject stays as it is; each subject once.
     */
    private async mergedOf(workspaceId: string, subjects: ReadonlyArray<RunSubject>): Promise<ReadonlyArray<RunSubject>> {
        const widened: Array<RunSubject> = []
        for (const subject of subjects) {
            const ids =
                subject.kind === PERSON_SUBJECT && this.contacts !== undefined
                    ? await this.contacts.aliasesOf(workspaceId, subject.id)
                    : [subject.id]
            for (const id of ids)
                if (!widened.some((one) => one.kind === subject.kind && one.id === id)) widened.push({ kind: subject.kind, id })
        }
        return widened
    }

    /** What waits for a person of the shop about the person: the steps of the open stops about them, oldest first. */
    async waitingOf(workspaceId: string, person: HeldPerson): Promise<ReadonlyArray<FlowWaiting>> {
        return (await this.openAbout(workspaceId, person)).map((stop) => ({ step: stop.stepKey, since: stop.since }))
    }

    /** An event was held behind `runId` (rule Q-1): told to the open stops of the run (ENGINE-FIN (a)); nothing in an app with no stops. */
    async eventHeld(workspaceId: string, runId: string, held: AgentWakeContext): Promise<void> {
        await this.stops?.eventHeld(workspaceId, runId, held)
    }

    private openAbout(workspaceId: string, person: HeldPerson): Promise<ReadonlyArray<PersonStop>> {
        if (this.stops === undefined || (person.contactId === null && person.routeId === null)) return Promise.resolve([])
        return this.stops.openAbout(workspaceId, person)
    }
}

/** The statuses of a run that is not finished: it holds its subject (running, parked at a wait or a retry, stopped for a person). */
const IN_FLIGHT: ReadonlySet<string> = new Set(["running", "waiting", "parked"])

/** Whether a run status is one of a run in flight. */
export const isInFlight = (status: string): boolean => IN_FLIGHT.has(status)
