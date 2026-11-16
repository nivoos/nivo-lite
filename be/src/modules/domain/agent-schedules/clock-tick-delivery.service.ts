import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import type { AgentTriggerRecord, TimerTask } from "@modules/domain/agent-work"
import { ProviderTriggersService, type DeliverResult, type OptionalPreparedDelivery } from "@modules/domain/provider-triggers"
import type { TimerOwner } from "./agent-schedules.contracts"
import { CLOCK_TICK_TRIGGER, TIMER_DUE_TRIGGER } from "./engine-time.triggers"

/** What delivering one slot came to: a run was woken, the slot was delivered before (`already_ran`), or no registered graph took it. */
export type SlotDelivery = "woken" | "already_ran" | "untaken"

/** What the delivery's answer says of one slot. */
export const slotDeliveryOf = (result: DeliverResult): SlotDelivery => {
    if (result.status !== "delivered") return "untaken"
    if (result.woken.length > 0) return "woken"
    return result.repeats > 0 ? "already_ran" : "untaken"
}

@Injectable()
/**
 * THE CLOCK'S ENTRY to the one event pipeline (concept triggers rule 13): one slot of one `agent_triggers` row, translated by the clock's
 * pure declaration and handed to the ONE delivery function for the row's own agent: prepared with no transaction open, committed in the
 * caller's transaction. The once-key is the
 * slot's old one (`<trigger row>:<slot>`), so the job, the sweep's missed-slot repair and a person's "run now" of the same slot are one
 * event. The receiver is the agent the row names; nothing else chooses it. The due timers of the agents' tasks enter the same way.
 */
export class ClockTickDeliveryService {
    constructor(private readonly triggers: ProviderTriggersService) {}

    /**
     * PREPARE of the slot (epoch milliseconds as text) of the row, with NO transaction open (concept outbox-job rule 12); `memberId` is the
     * person who pressed "run now", else null. Null when the slot is no event. Committed by `commit` in the caller's transaction.
     */
    prepareSlot(
        workspaceId: string,
        trigger: AgentTriggerRecord,
        slot: string,
        memberId: string | null,
    ): Promise<OptionalPreparedDelivery> {
        const event = CLOCK_TICK_TRIGGER.translate(
            { triggerId: trigger.id, slot },
            { connectionId: null },
        )
        if (event === null) return Promise.resolve(null)
        return this.triggers.prepare({
            workspaceId,
            declaration: CLOCK_TICK_TRIGGER,
            connectionId: null,
            agentId: trigger.agentId,
            events: [{ event, actorMemberId: memberId, occurredAt: new Date(Number(slot)).toISOString() }],
        })
    }

    /**
     * THE TIMER'S ENTRY: a timer that fell due (or a person's "run now" of it), translated by the timer's pure declaration and PREPARED for
     * the task's own agent (no transaction open), with the person the arming run had (its contact and route) beside the event. The
     * once-key is the timer's old one (`timer:<task>:<due instant>`), so a retried sweep and a press of the same timer are one event.
     */
    prepareTimer(
        owner: TimerOwner,
        taskId: string,
        timer: TimerTask,
        press: { readonly memberId: string; readonly at: Date } | null,
    ): Promise<OptionalPreparedDelivery> {
        const event = TIMER_DUE_TRIGGER.translate(
            {
                taskId,
                ref: timer.ref,
                ...(timer.data === undefined ? {} : { data: timer.data }),
                dueAt: timer.dueAt,
                ...(press === null ? {} : { firedAt: press.at.toISOString(), runNowBy: press.memberId }),
            },
            { connectionId: null },
        )
        if (event === null) return Promise.resolve(null)
        return this.triggers.prepare({
            workspaceId: owner.workspaceId,
            declaration: TIMER_DUE_TRIGGER,
            connectionId: null,
            agentId: owner.agentId,
            events: [
                {
                    event,
                    contactId: timer.subject.contactId,
                    routeId: timer.subject.conversationId,
                    actorMemberId: press?.memberId ?? null,
                    occurredAt: timer.dueAt,
                },
            ],
        })
    }

    /** COMMIT of a prepared slot or timer in the caller's transaction; a slot that was no event is `untaken`. */
    async commit(tx: EntityManager, prepared: OptionalPreparedDelivery): Promise<SlotDelivery> {
        if (prepared === null) return "untaken"
        return slotDeliveryOf(await this.triggers.deliver(prepared, tx))
    }
}
