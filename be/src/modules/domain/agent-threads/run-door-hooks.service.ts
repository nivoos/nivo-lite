import { Injectable, Optional, type OnModuleInit } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { reportFactsKind, type MessageFact } from "@nivo-lite/agent-sdk/team-chat"
import {
    AgentRunCancelService,
    AgentRunsService,
    type RunByPerson,
    type RunDoorHooks,
    type RunView,
} from "@modules/domain/agent-runs"
import {
    AgentGraphAiCoreService,
    AgentWorkflowRunsService,
    THREAD_SCOPE_MEMBER,
    callerRunIdOf,
    subjectOfScope,
} from "@modules/domain/agent-graphs"
import { AgentWakeService } from "@modules/domain/agent-work"
import { CustomerRoutesService } from "@modules/domain/customer-routes/customer-routes.service"
import { GraphNodeRegistryService, type NodeTurn } from "@modules/domain/graph-nodes"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectMessageCatalog, type MessageCatalog } from "@modules/platform/i18n"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { AgentThreadsLogEvent } from "./agent-threads.log-events"
import { PAUSED_REASON } from "./run-ended.policy"
import { RunStopRecordsService } from "./stops/run-stop-records.service"
import { RunStopsService } from "./stops/run-stops.service"
import { ThreadRunsService } from "./thread-runs.service"
import { ThreadSubjectHoldsService } from "./thread-subject-holds.service"

/** The key prefix of the one line the run door may send a customer after an end (once per run). */
const ENDED_LINE_KEY_PREFIX = "run-ended-line:"

/** What the run door did, as the team notice names it. */
type DoorAct = "ended" | "paused" | "resumed"

/** A text member of a run's context, or null. */
const textOf = (run: RunView, name: string): string | null => {
    const value: unknown = run.context[name]
    return typeof value === "string" && value !== "" ? value : null
}

/** The language of a run: its trigger's, Vietnamese when it names none the product speaks. */
const localeOfRun = (run: RunView): "vi" | "en" => (textOf(run, "locale") === "en" ? "en" : "vi")

@Injectable()
/**
 * WHAT THE RUN DOOR DOES AFTER ITS WRITE (`AgentRunCancelService`, registered at start): the thread engine's half of a person's End, Pause
 * and Resume, run once the write committed. END: (1) the run's open stops close with it, their cards rewritten in place with no live
 * button and the owner's items they wait on withdrawn (`RunStopsService.runClosed`, the one rule every closed run keeps: an approval
 * opened by an `ask` step is withdrawn, nothing is sent); a stop a person had taken over also ends that person's hold on the route (stops
 * rule 6: any decision that closes a taken-over stop ends the hold); (2) the wakes held behind it are pending again so the next run of the
 * subject takes them (the one holding rule's release), and the wakes held for its pause run once and end as `run_ended`; (3) the runs it
 * CALLED that are still in flight end with it through the same door (a child before nothing: each child's own hooks run); (4) the team is
 * told ONCE, in the agent's room with the founder; (5) only when the person asked, the agent's model words one line to the customer and
 * it goes through the normal send door (rights, do-not-contact, ledger), once per run. PAUSE: the team is told once. RESUME: the wakes held
 * while it was paused run in the order they came; a drive the pause stopped mid-way is driven again; the team is told once. A hook that
 * fails is logged and the write stands: the thread sweep closes an open stop of a closed run and releases wakes held behind a finished
 * one. Generic: runs, stops, wakes, subjects; no workflow, channel or business word.
 */
export class RunDoorHooksService implements RunDoorHooks, OnModuleInit {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectMessageCatalog() private readonly catalog: MessageCatalog,
        @InjectLogger() private readonly logger: Logger,
        private readonly door: AgentRunCancelService,
        private readonly runs: AgentRunsService,
        private readonly records: RunStopRecordsService,
        private readonly stops: RunStopsService,
        private readonly holds: ThreadSubjectHoldsService,
        private readonly wakes: AgentWakeService,
        private readonly threads: ThreadRunsService,
        private readonly nodes: GraphNodeRegistryService,
        @Optional() private readonly workflows?: AgentWorkflowRunsService,
        @Optional() private readonly core?: AgentGraphAiCoreService,
        @Optional() private readonly routes?: CustomerRoutesService,
    ) {}

    /** Registers with the run door once the app has started. */
    onModuleInit(): void {
        this.door.setHooks(this)
    }

    async ended(done: RunByPerson, tellCustomer: boolean): Promise<{ readonly children: number }> {
        const { run } = done
        const ref = { workspaceId: run.workspaceId, runId: run.id }
        const locale = localeOfRun(run)
        await this.guarded(run.id, "stops", async () => {
            const taken = (await this.records.ofRun(ref.workspaceId, ref.runId)).filter(
                (stop) => stop.state === "open" && stop.decision?.kind === "take_over" && stop.conversationId !== null,
            )
            await this.stops.runClosed(ref, { locale })
            await eachInOrder(taken, async (stop) => {
                if (stop.conversationId !== null) await this.routes?.release(ref.workspaceId, stop.conversationId)
            })
        })
        await this.guarded(run.id, "wakes", async () => {
            await this.holds.released(ref.workspaceId, ref.runId)
            await this.entityManager.transaction((tx) => this.wakes.releaseHeld(tx, ref.workspaceId, `${PAUSED_REASON}${run.id}`))
        })
        let children = 0
        await this.guarded(run.id, "children", async () => {
            await eachInOrder(await this.childrenOf(run), async (child) => {
                const answer = await this.door.endAs({ memberId: done.memberId, name: done.name }, run.workspaceId, child.id, false)
                if (answer.kind === "ended") children += 1 + answer.children
            })
        })
        const line = tellCustomer ? await this.customerTold(run) : null
        await this.told(done, "ended", [
            ...(children === 0 ? [] : [this.fact("children", String(children), locale)]),
            ...(line === null ? [] : [this.fact("customerLine", line, locale)]),
        ])
        this.logger.info(AgentThreadsLogEvent.RunDoorDone, { runId: run.id, kind: "ended", children, told: line !== null })
        return { children }
    }

    async paused(done: RunByPerson): Promise<void> {
        await this.told(done, "paused", [])
        this.logger.info(AgentThreadsLogEvent.RunDoorDone, { runId: done.run.id, kind: "paused" })
    }

    async resumed(done: RunByPerson): Promise<void> {
        const { run } = done
        let released = 0
        await this.guarded(run.id, "wakes", async () => {
            released = await this.entityManager.transaction((tx) =>
                this.wakes.releaseHeld(tx, run.workspaceId, `${PAUSED_REASON}${run.id}`),
            )
            // A drive the pause stopped before a step has no wake left once its wake was released and ran; one re-drive per resume (a
            // stopped thread runs nothing on it).
            await this.threads.redrive({ workspaceId: run.workspaceId, runId: run.id }, `resumed:${new Date().toISOString()}`)
        })
        await this.told(done, "resumed", [])
        this.logger.info(AgentThreadsLogEvent.RunDoorDone, { runId: run.id, kind: "resumed", released })
    }

    /** The runs this run called that are still in flight: runs of its subject whose call names it (a keyless run has none). */
    private async childrenOf(run: RunView): Promise<ReadonlyArray<RunView>> {
        const scopeKey: unknown = run.context[THREAD_SCOPE_MEMBER]
        const subject = typeof scopeKey === "string" ? subjectOfScope({ scopeKey, context: run.context }) : null
        if (subject === null) return []
        const holders = await this.runs.inFlightOfSubject(run.workspaceId, subject)
        const found: Array<RunView> = []
        await eachInOrder(holders, async (holder) => {
            if (holder.id === run.id) return
            const child = await this.runs.runOf(run.workspaceId, holder.id)
            if (child !== null && callerRunIdOf(child.context) === run.id) found.push(child)
        })
        return found
    }

    /**
     * The one line to the run's customer the person asked for: worded by the agent's model from the conversation, sent through the normal
     * send door (rights, do-not-contact, ledger) once per run. Null when the run has no customer route, the model says nothing, or the
     * send refused it (the notice then says nothing was sent).
     */
    private async customerTold(run: RunView): Promise<string | null> {
        const conversationId = textOf(run, "conversationId")
        const send = this.nodes.optionalExecutorOf(TOOL.customerMessageSend)
        if (conversationId === null || send === undefined || this.core === undefined) return null
        const turn = this.turnOf(run)
        try {
            const text = await this.core.endingLine(turn, conversationId, run.context)
            if (text === null) return null
            const key = `${ENDED_LINE_KEY_PREFIX}${run.id}`
            const contactId = textOf(run, "contactId")
            const sent = await send.execute(turn, { ...(contactId === null ? {} : { contactId }), text }, { key, dedupeKey: key })
            return sent.kind === "refused" ? null : text
        } catch (cause) {
            this.logger.error(AgentThreadsLogEvent.RunDoorHookFailed, cause, { runId: run.id, hook: "customer_line" })
            return null
        }
    }

    /** The team is told ONCE per act, in the agent's room with the founder: who did what to which run. */
    private async told(done: RunByPerson, act: DoorAct, more: ReadonlyArray<MessageFact>): Promise<void> {
        const { run } = done
        const post = this.nodes.optionalExecutorOf(TOOL.teamMessagePost)
        if (post === undefined) return
        const locale = localeOfRun(run)
        const word = (key: string, params: Readonly<Record<string, string>> = {}): string =>
            this.catalog.get(`agentGraphs.runDoor.${key}`, params, locale)
        const [pin] = (await this.workflows?.pinsOf(run.workspaceId, [run.id])) ?? []
        const workflow = pin?.workflowName ?? ""
        const contact = textOf(run, "contactId")
        const facts: ReadonlyArray<MessageFact> = [
            ...(workflow === "" ? [] : [this.fact("workflow", workflow, locale)]),
            this.fact("by", done.name, locale),
            ...more,
            ...(contact === null ? [] : [{ ...this.fact("contact", contact, locale), technical: true }]),
            { ...this.fact("run", run.id, locale), technical: true },
        ]
        // Once per act and moment: a pause, a resume and a second pause of the same run are three notices; a replay of one is none.
        const key = `run-door:${run.id}:${act}:${act === "ended" ? "" : (textOf(run, "pausedAt") ?? new Date().toISOString())}`
        try {
            await post.execute(
                this.turnOf(run),
                {
                    kind: reportFactsKind.id,
                    title: word(`${act}.title`),
                    text: word(`${act}.sentence`, { name: done.name }),
                    facts: facts.map((fact) => ({ ...fact })),
                    audience: "founder",
                },
                { key, dedupeKey: key },
            )
        } catch (cause) {
            this.logger.error(AgentThreadsLogEvent.RunDoorHookFailed, cause, { runId: run.id, hook: "notice" })
        }
    }

    private fact(name: string, value: string, locale: "vi" | "en"): MessageFact {
        return { name: this.catalog.get(`agentGraphs.runDoor.fact.${name}`, {}, locale), value, technical: false }
    }

    /** The turn the run door speaks in: the run's agent, its route and person, in its language; no step (a person's act, not a step's). */
    private turnOf(run: RunView): NodeTurn {
        const contactId = textOf(run, "contactId")
        return {
            turnId: run.id,
            workspaceId: run.workspaceId,
            agentId: run.agentId,
            subject: null,
            conversationId: textOf(run, "conversationId"),
            ...(contactId === null ? {} : { contactId }),
            locale: localeOfRun(run),
            origin: "system",
        }
    }

    private async guarded(runId: string, hook: string, work: () => Promise<void>): Promise<void> {
        try {
            await work()
        } catch (cause) {
            this.logger.error(AgentThreadsLogEvent.RunDoorHookFailed, cause, { runId, hook })
        }
    }
}
