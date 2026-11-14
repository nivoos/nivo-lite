import { mock, mockEntityManager } from "@starci/jest-preset"
import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import type { AgentWake, AgentWakeService } from "@modules/domain/agent-work"
import { burstFor } from "@modules/domain/agent-work/agent-work.policy"
import { bankTransactionTriggerFor } from "@modules/domain/bank-feed-inbox"
import type { ConnectionBindingsReadService } from "@modules/domain/connections"
import { ProviderTriggersService, triggerDeclarations, type ProviderTriggerReceivers } from "@modules/domain/provider-triggers"
import type { Logger } from "@modules/platform/logging"
import { ChatWorld } from "./thread-world-chat"
import { connectionRecordOf, nextTurnOf, wakeQueueOf } from "./thread-world-intake"
import { TickingClock } from "./thread-world-outside"
import { WS } from "./thread-world-records"

// RULE Q-4 `each` (QB-P5 C-3), the SECOND KIND of workflow (R75): bank credits, which declare no `combine` (= `each`: every event a fact of
// its own). A registration keyed by its OWN member (`data.content`, the order the payer names: allowed, trigger-delivery.policy) makes three
// credits of one order ONE subject. While the run of that subject is in flight, each new credit is held behind it ONE BY ONE, in arrival
// order: nothing is folded, no wake names a mode, the wake table's combine is never asked; when the run ends they are offered again oldest
// first and the next run begins on the oldest (its queue: the rest, in order). And a credit can never be declared a `stream` (it feeds no
// engine stream): the registry refuses it. Real: the bank feed's declaration and translate, `deliver` (MATCH, CORRELATE, the context), the
// registry. Doubles: the registration (a receivers stub with its own key), the wake table (the world's, with the engine's combine), the
// drain's hold (the world's drain model: a wake that meets a run in flight is held `waiting:<run>`, as the flow's holding rule ends it).

const SEPAY = "sepay-1"
const PAYMENT = "wf-payment"

/** The world: one bank account, one agent whose payment registration keys credits by the order the payer names. */
const worldOf = () => {
    const chat = new ChatWorld()
    const declaration = bankTransactionTriggerFor(PROVIDER.sepay)
    if (declaration === null) throw new Error("no sepay declaration")
    triggerDeclarations.register(declaration)
    const combine = jest.fn(wakeQueueOf(chat).coalesce)
    const wakes = mock<AgentWakeService>({
        ...wakeQueueOf(chat),
        coalesce: combine,
        write: (_tx: unknown, wake: AgentWake) => {
            if (chat.wakes.some((one) => one.agentId === wake.agentId && one.eventKey === wake.eventKey)) return Promise.resolve(null)
            const id = `credit-wake-${chat.wakes.length + 1}`
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
        attachedTo: () => Promise.resolve(["sales"]),
        takerOf: () => Promise.resolve({ workflowId: PAYMENT, ownKey: "data.content" }),
    })
    const bindings = mock<ConnectionBindingsReadService>({
        recordOf: (workspaceId: string, id: string) => Promise.resolve(connectionRecordOf(workspaceId, { id, provider: PROVIDER.sepay })),
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
        bindings,
        receivers,
        null,
        undefined,
        undefined,
        wakes,
    )
    const credit = async (transactionId: string, amount: number): Promise<void> => {
        const event = declaration.translate(
            { transactionId, amount, direction: "credit", content: "DH1001", at: "2026-11-14T10:00:00.000Z", source: PROVIDER.sepay },
            { connectionId: SEPAY },
        )
        if (event === null) throw new Error("the credit does not translate")
        await service.deliver(
            { workspaceId: WS, declaration, connectionId: SEPAY, agentId: null, events: [{ event, raw: { type: "sepay.transaction", id: `row-${transactionId}` } }] },
            mockEntityManager(),
        )
    }
    return { chat, credit, combine, declaration }
}

describe("`each` (a bank credit): events held behind a subject's run are kept one by one, in order, none folded", () => {
    it("3 credits of one order while its run is in flight: 3 held wakes in arrival order, no mode, nothing combined; released oldest first", async () => {
        const { chat, credit, combine } = worldOf()
        await credit("tx-1", 100_000)
        const [first] = chat.wakes
        expect(first?.scopeKey).toBe("key:data.content=DH1001")
        // The world's drain begins the first credit's run: the subject (the order) is in flight.
        if (first !== undefined) first.state = "begun"
        const RUN = "run-order-1"

        await credit("tx-2", 200_000)
        await credit("tx-3", 300_000)
        await credit("tx-4", 400_000)
        const later = chat.wakes.slice(1)
        // Three wakes of their own: no mode on the wake, none closed, the wake table's combine never asked.
        expect(later.map((wake) => [wake.context.eventId, wake.context.combine, wake.state])).toEqual([
            ["tx-2", undefined, "pending"],
            ["tx-3", undefined, "pending"],
            ["tx-4", undefined, "pending"],
        ])
        expect(combine).not.toHaveBeenCalled()
        // The drain meets the run in flight for each: held behind it, one by one (the flow's holding rule ends each `waiting:<run>`).
        for (const wake of later) Object.assign(wake, { state: "held", reason: `waiting:${RUN}` })

        const queue = wakeQueueOf(chat)
        const manager = mockEntityManager()
        expect((await queue.heldBehind(manager, WS, RUN, 50)).map((wake) => wake.context.eventId)).toEqual(["tx-2", "tx-3", "tx-4"])
        expect(await queue.waitingCountOf(manager, WS, RUN)).toBe(3)
        // The run ends: offered again, oldest first; the next run begins on the oldest and its queue is the rest, in order.
        expect(await queue.releaseWaiting(manager, WS, RUN)).toBe(3)
        expect(nextTurnOf(later)?.context.eventId).toBe("tx-2")
        expect((await queue.pendingOfScope(manager, WS, "sales", "key:data.content=DH1001", 50)).map((wake) => wake.context.eventId)).toEqual([
            "tx-2",
            "tx-3",
            "tx-4",
        ])
    })

    it("a credit can never combine as a stream: it feeds no engine stream, the registry refuses it at boot", () => {
        const { declaration } = worldOf()
        expect(() => triggerDeclarations.register({ ...declaration, name: "transaction.as-stream", combine: "stream" })).toThrow(
            expect.objectContaining({ code: "PROVIDER_TRIGGERS_DECLARATION_STREAMLESS" }),
        )
        expect(declaration.verb).toBe(TRIGGER.paymentCreditReceived)
    })
})
