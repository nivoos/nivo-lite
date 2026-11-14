import { mock, mockEntityManager } from "@starci/jest-preset"
import { TRIGGER } from "@nivo-lite/agent-sdk/names"
import type { AgentWake, AgentWakeService } from "@modules/domain/agent-work"
import { burstFor } from "@modules/domain/agent-work/agent-work.policy"
import { TIMER_DUE_TRIGGER } from "@modules/domain/agent-schedules/engine-time.triggers"
import type { ConnectionBindingsReadService } from "@modules/domain/connections"
import { ProviderTriggersService, triggerDeclarations, type ProviderTriggerReceivers } from "@modules/domain/provider-triggers"
import { streamScopeOf } from "@modules/domain/provider-triggers/trigger-delivery.policy"
import type { Logger } from "@modules/platform/logging"
import { ChatWorld } from "./thread-world-chat"
import { nextTurnOf, wakeQueueOf } from "./thread-world-intake"
import { TickingClock } from "./thread-world-outside"
import { WS } from "./thread-world-records"

// RULE Q-4 `latest` (QB-LATEST, QUEUE-DESIGN C.3): the events of a declaration that combines as `latest` are SNAPSHOTS of one subject's
// state, so only the newest waits. The engine's timer due declares it (a due is "this task is due now": the task row keeps one due at a
// time). Three dues of one task arrive while the run of that task is in flight: each new one, right after it is written, closes the older
// un-run one `replaced:<itself>` (never retried, never re-offered), so behind the run there is ONE held wake, the newest, standing for 3;
// when the run ends ONE run begins, on the newest due, with the ordinary one-event scope (no stream members). CONTROL (R75, the same three
// on the same kind of declaration with no `combine` = `each`): three held wakes, released oldest first, the door's replace never asked.
// Real: the timer's declaration and translate, `deliver` (MATCH, CORRELATE, the wake context, the call of the door with the wake just
// written), the pure replace decision (in the world's wake table, as in `AgentWakeService.replaceOlder`), the scope members of a wake.
// Doubles: the registration (a receivers stub), the wake table (the world's), the drain's hold (the world's drain model: a wake that meets
// the run in flight is held `waiting:<run>`, as the flow's holding rule ends it).

const REMIND = "wf-remind"
const TASK = "task-remind-1"
const RUN = "run-remind-1"

/** The world: one agent whose remind registration takes its timers; the timer declaration as given (`latest`) or with no mode (`each`). */
const worldOf = (mode: "latest" | "each") => {
    const chat = new ChatWorld()
    const { combine: _latest, ...plain } = TIMER_DUE_TRIGGER
    const declaration = mode === "latest" ? TIMER_DUE_TRIGGER : { ...plain, name: "timer.due-each-control" }
    triggerDeclarations.register(declaration)
    const queue = wakeQueueOf(chat)
    const replaceOlder = jest.fn(queue.replaceOlder)
    const coalesce = jest.fn(queue.coalesce)
    const wakes = mock<AgentWakeService>({
        ...queue,
        replaceOlder,
        coalesce,
        write: (_tx: unknown, wake: AgentWake) => {
            if (chat.wakes.some((one) => one.agentId === wake.agentId && one.eventKey === wake.eventKey)) return Promise.resolve(null)
            const id = `due-wake-${chat.wakes.length + 1}`
            const burst = wake.settle === undefined ? null : burstFor(wake.settle)
            chat.wakes.push({
                ...structuredClone(wake),
                scopeKey: wake.scopeKey ?? "agent",
                id,
                createdAt: new Date(Date.UTC(2026, 10, 14, 10, 0, 0, chat.wakes.length)),
                state: "pending",
                burst,
            })
            return Promise.resolve(id)
        },
    })
    const receivers = mock<ProviderTriggerReceivers>({
        attachedTo: () => Promise.resolve(["care"]),
        takerOf: () => Promise.resolve({ workflowId: REMIND, ownKey: null }),
    })
    type Store = ConstructorParameters<typeof ProviderTriggersService>[3]
    const service = new ProviderTriggersService(
        mockEntityManager(),
        new TickingClock(),
        mock<Logger>(),
        mock<Store>({
            find: (_tx: unknown, connectionId: string, name: string) =>
                Promise.resolve(mock<NonNullable<Awaited<ReturnType<Store["find"]>>>>({ id: `switch:${connectionId}:${name}`, workspaceId: WS, enabled: true, enabledAt: null })),
            markFired: () => Promise.resolve(),
        }),
        mock<ConnectionBindingsReadService>(),
        receivers,
        null,
        undefined,
        undefined,
        wakes,
    )
    /** The timer of `taskId` falls due at `dueAt` (the minute sweep's delivery: one event per task and due instant). */
    const due = async (dueAt: string, taskId: string = TASK): Promise<void> => {
        const event = declaration.translate({ taskId, ref: "remind", data: { round: dueAt }, dueAt }, { connectionId: null })
        if (event === null) throw new Error("the due does not translate")
        await service.deliver(
            { workspaceId: WS, declaration, connectionId: null, agentId: "care", events: [{ event, actorMemberId: null, occurredAt: dueAt }] },
            mockEntityManager(),
        )
    }
    /** The world's drain meets the run in flight: every pending wake of the task is held behind it. */
    const holdBehindRun = (): void => {
        for (const wake of chat.wakes) if (wake.state === "pending" && wake.scopeKey === `key:data.taskId=${TASK}`) Object.assign(wake, { state: "held", reason: `waiting:${RUN}` })
    }
    return { chat, due, holdBehindRun, replaceOlder, coalesce }
}

const DUES = ["2026-11-14T10:01:00.000Z", "2026-11-14T10:02:00.000Z", "2026-11-14T10:03:00.000Z"] as const
const eventOf = (dueAt: string, taskId: string = TASK): string => `timer:${taskId}:${String(Date.parse(dueAt))}`

describe("`latest` (a timer due): only the newest event of a subject waits behind its run", () => {
    it("3 dues of one task behind its run in flight: 2 closed `replaced:<newer>`, ONE held wake (the newest, count 3); ONE run on it, ordinary scope", async () => {
        const { chat, due, holdBehindRun, replaceOlder, coalesce } = worldOf("latest")
        // The task's first due began its run: the subject (the task) is in flight.
        await due("2026-11-14T10:00:00.000Z")
        const [first] = chat.wakes
        expect(first?.scopeKey).toBe(`key:data.taskId=${TASK}`)
        if (first !== undefined) first.state = "begun"

        for (const dueAt of DUES) {
            await due(dueAt)
            holdBehindRun()
        }
        const [w2, w3, w4] = chat.wakes.slice(1)
        // Each new due replaced the older one waiting: typed reason naming the newer wake, closed (begins nothing, never re-offered).
        expect([w2, w3, w4].map((wake) => [wake?.context.eventId, wake?.state, wake?.reason ?? null])).toEqual([
            [eventOf(DUES[0]), "queued", `replaced:${w3?.id ?? ""}`],
            [eventOf(DUES[1]), "queued", `replaced:${w4?.id ?? ""}`],
            [eventOf(DUES[2]), "held", `waiting:${RUN}`],
        ])
        expect(w4?.context).toMatchObject({ combine: "latest", count: "3", eventId: eventOf(DUES[2]) })
        // The door was told the wake just written each time; the stream door never asked; the begun run's own wake untouched.
        expect(replaceOlder.mock.calls.map(([, , newest]) => newest)).toEqual([first?.id, w2?.id, w3?.id, w4?.id])
        expect(coalesce).not.toHaveBeenCalled()
        expect(first?.state).toBe("begun")

        const queue = wakeQueueOf(chat)
        const manager = mockEntityManager()
        expect(await queue.waitingCountOf(manager, WS, RUN)).toBe(1)
        // The run ends: ONE wake offered again; the next run begins on the NEWEST due and its queue holds nothing else of the task.
        expect(await queue.releaseWaiting(manager, WS, RUN)).toBe(1)
        const next = nextTurnOf(chat.wakes)
        expect(next?.id).toBe(w4?.id)
        expect(JSON.parse(String(next?.context.dataJson))).toMatchObject({ taskId: TASK, dueAt: DUES[2], data: { round: DUES[2] } })
        expect((await queue.pendingOfScope(manager, WS, "care", `key:data.taskId=${TASK}`, 50)).map((wake) => wake.id)).toEqual([w4?.id])
        // The ordinary one-event scope: a `latest` wake adds no stream member (`since` / `count` belong to a stream marker).
        expect(next === undefined ? null : streamScopeOf(next.context, next.createdAt)).toEqual({})
    })

    it("a due of ANOTHER task (another subject) is never replaced: each subject keeps its own newest", async () => {
        const { chat, due } = worldOf("latest")
        await due(DUES[0])
        await due(DUES[0], "task-other")
        await due(DUES[1])
        expect(chat.wakes.map((wake) => [wake.context.eventId, wake.state, wake.reason ?? null])).toEqual([
            [eventOf(DUES[0]), "queued", `replaced:${chat.wakes[2]?.id ?? ""}`],
            [eventOf(DUES[0], "task-other"), "pending", null],
            [eventOf(DUES[1]), "pending", null],
        ])
        expect(TIMER_DUE_TRIGGER.verb).toBe(TRIGGER.timerDue)
    })
})

describe("CONTROL `each`: the same three dues on a declaration with no mode stay three", () => {
    it("3 held wakes in arrival order, no mode on any, the replace door never asked; released oldest first", async () => {
        const { chat, due, holdBehindRun, replaceOlder, coalesce } = worldOf("each")
        await due("2026-11-14T10:00:00.000Z")
        const [first] = chat.wakes
        if (first !== undefined) first.state = "begun"
        for (const dueAt of DUES) {
            await due(dueAt)
            holdBehindRun()
        }
        const later = chat.wakes.slice(1)
        expect(later.map((wake) => [wake.context.eventId, wake.context.combine, wake.state, wake.reason])).toEqual(
            DUES.map((dueAt) => [eventOf(dueAt), undefined, "held", `waiting:${RUN}`]),
        )
        expect(replaceOlder).not.toHaveBeenCalled()
        expect(coalesce).not.toHaveBeenCalled()

        const queue = wakeQueueOf(chat)
        const manager = mockEntityManager()
        expect(await queue.releaseWaiting(manager, WS, RUN)).toBe(3)
        expect(nextTurnOf(later)?.context.eventId).toBe(eventOf(DUES[0]))
    })
})
