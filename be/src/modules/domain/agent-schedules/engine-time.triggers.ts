import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import { z } from "zod"
import type { OptionalCanonicalEvent, TriggerDeclaration } from "@modules/domain/provider-triggers"

/*
 * THE ENGINE'S TIME SOURCES (stage 1 of the one event pipeline, concept triggers rule 13): a slot of a clock trigger and a due timer, each
 * declared like any provider's trigger, with a pure translate of what the source fired. The receiver is the agent the source row names (the
 * clock's `agent_triggers` row, the timer's task): the entry hands that agent to the delivery, nothing else chooses it. A clock tick only
 * starts a workflow (each slot its own run); listing and fan-out are that workflow's own steps.
 */

/** The clock's trigger name. */
export const CLOCK_TICK = "clock.tick"

/** The timer's trigger name. */
export const TIMER_DUE = "timer.due"

/** What one slot of a clock trigger fired: the trigger row and the slot (epoch milliseconds as text). */
export type ClockSlot = {
    readonly triggerId: string
    readonly slot: string
}

/** The data of a clock tick: the row that fired and the slot it fired for. */
export type ClockTickData = {
    readonly triggerId: string
    readonly slotMs: number
}

/** The translate of a clock slot: one event per (trigger row, slot), the once-key the slot's wake always had. */
export const translateClockSlot = (slot: ClockSlot): OptionalCanonicalEvent<ClockTickData> => {
    const slotMs = Number(slot.slot)
    if (slot.triggerId === "" || !Number.isSafeInteger(slotMs)) return null
    return {
        id: `${slot.triggerId}:${slot.slot}`,
        data: { triggerId: slot.triggerId, slotMs },
    }
}

/** The clock's declaration: no key, every slot its own run. */
export const CLOCK_TICK_TRIGGER: TriggerDeclaration<ClockSlot, ClockTickData> = {
    provider: PROVIDER.nivo,
    name: CLOCK_TICK,
    verb: TRIGGER.clockTick,
    via: ["clock"],
    // The minute sweep of the agents' work (`agent-work-sweep` tick) makes the scheduler of a late trigger agree with its row and writes one
    // wake for the LATEST slot it missed (never a replay of every missed one): the same event id as the slot's own firing.
    withoutPoll: {
        reason: {
            vi: "Việc quét mỗi phút (agent-work-sweep) bù lượt chạy theo lịch bị lỡ: một lượt cho khung giờ mới nhất bị lỡ, không chạy bù hết.",
            en: "The minute sweep (agent-work-sweep) repairs a late schedule: one run for the latest missed slot, never a replay of all of them.",
        },
        source: "nivo:agent-work-sweep",
    },
    words: {
        title: { vi: "Đồng hồ · đến giờ chạy", en: "Clock · time to run" },
        summary: {
            vi: "Đến một khung giờ của lịch bạn đặt (mỗi khung giờ là một lượt chạy riêng).",
            en: "A slot of the schedule you set has come (each slot is its own run).",
        },
        members: {
            triggerId: { vi: "Mã lịch đã chạy.", en: "The id of the schedule that fired." },
            slotMs: { vi: "Khung giờ, tính bằng mili giây.", en: "The slot, in epoch milliseconds." },
        },
    },
    raw: z.object({ triggerId: z.string(), slot: z.string() }),
    data: z.object({ triggerId: z.string().min(1), slotMs: z.number().int() }),
    translate: translateClockSlot,
    key: { by: "none" },
    settle: null,
}

/** A timer that fell due, as its task holds it: the task, the arm's `ref` and `data`, the due instant, who pressed "run now". */
export type DueTimer = {
    readonly taskId: string
    readonly ref: string
    readonly data?: Readonly<Record<string, string | number | boolean | null>> | undefined
    readonly dueAt: string
    /** When it fired, when that is not its due instant (a person's "run now"). */
    readonly firedAt?: string | undefined
    readonly runNowBy?: string | undefined
}

/** The data of a due timer: the task (the key: one task per agent, person and ref), the ref, the arm's data and the moment it fired. */
export type TimerDueData = {
    readonly taskId: string
    readonly ref: string
    readonly data: Readonly<Record<string, string | number | boolean | null>>
    readonly dueAt: string
    readonly runNowBy?: string | undefined
}

/** The translate of a due timer: one event per (task, due instant), the once-key the timer's wake always had. */
export const translateDueTimer = (timer: DueTimer): OptionalCanonicalEvent<TimerDueData> => {
    const due = Date.parse(timer.dueAt)
    if (timer.taskId === "" || timer.ref === "" || Number.isNaN(due)) return null
    return {
        id: `timer:${timer.taskId}:${String(due)}`,
        data: {
            taskId: timer.taskId,
            ref: timer.ref,
            data: timer.data ?? {},
            dueAt: timer.firedAt ?? timer.dueAt,
            ...(timer.runNowBy === undefined ? {} : { runNowBy: timer.runNowBy }),
        },
    }
}

/** A flat record of JSON scalars (a timer's `data`). */
const SCALARS = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))

/** The timer's declaration, keyed by its task. The person it is about rides beside the event (the arming run's contact and route). */
export const TIMER_DUE_TRIGGER: TriggerDeclaration<DueTimer, TimerDueData> = {
    provider: PROVIDER.nivo,
    name: TIMER_DUE,
    verb: TRIGGER.timerDue,
    via: ["clock"],
    // The same sweep writes the wake of a timer that fell due (a task whose time has come), keyed by the task and its due instant.
    withoutPoll: {
        reason: {
            vi: "Việc quét mỗi phút (agent-work-sweep) tìm hẹn giờ đã đến hạn mà chưa chạy và báo cho agent, mỗi hẹn giờ chỉ một lần.",
            en: "The minute sweep (agent-work-sweep) finds a timer that fell due and was not run, and wakes the agent, once per timer.",
        },
        source: "nivo:agent-work-sweep",
    },
    words: {
        title: { vi: "Hẹn giờ · đến hạn", en: "Timer · due" },
        summary: {
            vi: "Một hẹn giờ mà agent đã đặt đã đến hạn.",
            en: "A timer an agent armed has fallen due.",
        },
        members: {
            taskId: { vi: "Mã việc của hẹn giờ.", en: "The id of the timer's task." },
            ref: { vi: "Tên hẹn giờ do agent đặt.", en: "The name the agent gave the timer." },
            data: { vi: "Dữ liệu agent gắn kèm khi đặt hẹn giờ.", en: "The data the agent attached when arming it." },
            dueAt: { vi: "Thời điểm đến hạn.", en: "When it fell due." },
            runNowBy: { vi: "Người bấm chạy ngay, nếu có.", en: "The person who pressed run now, if any." },
        },
    },
    raw: z.object({
        taskId: z.string(),
        ref: z.string(),
        data: SCALARS.optional(),
        dueAt: z.string(),
        firedAt: z.string().optional(),
        runNowBy: z.string().optional(),
    }),
    data: z.object({
        taskId: z.string().min(1),
        ref: z.string().min(1),
        data: SCALARS,
        dueAt: z.string(),
        runNowBy: z.string().optional(),
    }),
    translate: translateDueTimer,
    key: { by: "data", member: "taskId" },
    settle: null,
    // Rule Q-4 `latest`: a due is a SNAPSHOT of its task's one timer ("this task is due now"), not a fact to count: the task row keeps one
    // due at a time (armed again = the same row, a new due), and a person's "run now" is that same state. Dues of one task waiting behind
    // its subject's run therefore mean one thing: the newest replaces the older ones, so the workflow runs once on the task's current state.
    combine: "latest",
}

/** The engine's time triggers. */
export const ENGINE_TIME_TRIGGERS: ReadonlyArray<TriggerDeclaration<ClockSlot, ClockTickData> | TriggerDeclaration<DueTimer, TimerDueData>> = [
    CLOCK_TICK_TRIGGER,
    TIMER_DUE_TRIGGER,
]
