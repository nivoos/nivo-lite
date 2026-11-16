import { Test } from "@nestjs/testing"
import { mock, mockEntityManager } from "@starci/jest-preset"
import { TRIGGER } from "@nivo-lite/agent-sdk/names"
import { DeliveredWakesService } from "@modules/domain/provider-triggers/delivered-wakes.service"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { handBackEventOf } from "./thread-hand-back.policy"
import { ThreadHandBacksService } from "./thread-hand-backs.service"

/** The keys of the sale's payment wait, as its params hold them (each key one meaning listing its verbs: templates rule 12). */
const ON = [
    { key: "paid", verbs: [TRIGGER.paymentCreditReceived] },
    { key: "said", verbs: [TRIGGER.zaloMessageReceived, TRIGGER.telegramMessageReceived] },
    { key: "ordered", verbs: [TRIGGER.recordWritten] },
]

/** What the wait answered when the person's line came. */
const SAID = { trigger: "said", event: { eventId: "m-9", verb: TRIGGER.zaloMessageReceived, accountId: "acc-zalo", routeId: "route-1", data: { text: "hoi chut" } } }

describe("handBackEventOf: which event a hand-back gives back (the wait's own output)", () => {
    it("the event of the key that came, with the verb that key listens for", () => {
        expect(handBackEventOf(SAID, ON)).toEqual({ verb: TRIGGER.zaloMessageReceived, eventId: "m-9", accountId: "acc-zalo" })
    })

    it("a key of several verbs (one meaning on several channels): the event's own verb, when the key lists it", () => {
        const onTelegram = { trigger: "said", event: { ...SAID.event, verb: TRIGGER.telegramMessageReceived, accountId: "acc-tg" } }
        expect(handBackEventOf(onTelegram, ON)).toEqual({ verb: TRIGGER.telegramMessageReceived, eventId: "m-9", accountId: "acc-tg" })
        const onZalo = { trigger: "said", event: { ...SAID.event, verb: TRIGGER.zaloMessageReceived } }
        expect(handBackEventOf(onZalo, ON)).toEqual({ verb: TRIGGER.zaloMessageReceived, eventId: "m-9", accountId: "acc-zalo" })
        // A verb the key does not list, or none named, is no event of it.
        expect(handBackEventOf({ trigger: "said", event: { ...SAID.event, verb: TRIGGER.facebookMessageReceived } }, ON)).toBeNull()
        expect(handBackEventOf({ trigger: "said", event: { eventId: "m-9", data: {} } }, ON)).toBeNull()
    })

    it("the second kind: a record write the wait took (no account, no person) is given back by its one verb", () => {
        const written = { trigger: "ordered", event: { eventId: "blocks-core.sales.order:order-1:v3", data: { type: "blocks-core.sales.order", recordId: "order-1" } } }
        expect(handBackEventOf(written, ON)).toEqual({ verb: TRIGGER.recordWritten, eventId: "blocks-core.sales.order:order-1:v3", accountId: null })
    })

    it("nothing for the timeout, an unknown key, or an event with no id", () => {
        expect(handBackEventOf({ trigger: "timeout" }, ON)).toBeNull()
        expect(handBackEventOf({ trigger: "other", event: SAID.event }, ON)).toBeNull()
        expect(handBackEventOf({ trigger: "said", event: { data: {} } }, ON)).toBeNull()
    })
})

describe("ThreadHandBacksService: the event goes back to the next waiter, then to the registered graphs", () => {
    const build = async () => {
        const wakes = mock<DeliveredWakesService>()
        wakes.reoffer.mockResolvedValue(2)
        const manager = mockEntityManager()
        manager.transaction.mockImplementation(((work: (tx: unknown) => Promise<unknown>) => work(manager)) as never)
        const moduleRef = await Test.createTestingModule({
            providers: [
                ThreadHandBacksService,
                { provide: DeliveredWakesService, useValue: wakes },
                { provide: PRIMARY_ENTITY_MANAGER, useValue: manager },
                { provide: LOGGER, useValue: mock<Logger>() },
            ],
        }).compile()
        return { handBacks: moduleRef.get(ThreadHandBacksService), wakes, manager }
    }

    it("re-offers every wake of the event (its delivery's once-key: verb, account, id), naming this run", async () => {
        const { handBacks, wakes, manager } = await build()

        await expect(handBacks.handBack({ workspaceId: "ws-1", runId: "run-sale", agentId: "agent-sales" }, SAID, ON)).resolves.toEqual({
            kind: "handed_back",
            wakes: 2,
        })
        expect(wakes.reoffer).toHaveBeenCalledWith(
            manager,
            "ws-1",
            { source: "trigger", eventKey: `${TRIGGER.zaloMessageReceived}:acc-zalo:m-9`, reason: "wait_took" },
            "run-sale",
        )
    })

    it("an engine source's event (no account) is keyed by the agent it was delivered to", async () => {
        const { handBacks, wakes } = await build()
        const due = { trigger: "due", event: { eventId: "task-1:2026" } }

        await handBacks.handBack({ workspaceId: "ws-1", runId: "run-1", agentId: "agent-1" }, due, [{ key: "due", verbs: [TRIGGER.timerDue] }])
        expect(wakes.reoffer.mock.calls[0]?.[2]).toMatchObject({ eventKey: `${TRIGGER.timerDue}:agent-1:task-1:2026` })
    })

    it("a wait that took no event gives nothing back", async () => {
        const { handBacks, wakes } = await build()

        await expect(handBacks.handBack({ workspaceId: "ws-1", runId: "run-1", agentId: "agent-1" }, { trigger: "timeout" }, ON)).resolves.toEqual({
            kind: "no_event",
        })
        expect(wakes.reoffer).not.toHaveBeenCalled()
    })
})

describe("ThreadHandBacksService.offerToWait: the events held behind a run are offered to its next wait first", () => {
    it("re-pends the run's held `waiting:<run>` wakes in one transaction", async () => {
        const wakes = mock<DeliveredWakesService>()
        wakes.releaseWaiting.mockResolvedValue(2)
        const manager = mockEntityManager()
        manager.transaction.mockImplementation(((work: (tx: unknown) => Promise<unknown>) => work(manager)) as never)
        const moduleRef = await Test.createTestingModule({
            providers: [
                ThreadHandBacksService,
                { provide: DeliveredWakesService, useValue: wakes },
                { provide: PRIMARY_ENTITY_MANAGER, useValue: manager },
            ],
        }).compile()

        await expect(moduleRef.get(ThreadHandBacksService).offerToWait("ws-1", "run-sale")).resolves.toBe(2)
        expect(wakes.releaseWaiting).toHaveBeenCalledWith(manager, "ws-1", "run-sale")
    })
})
