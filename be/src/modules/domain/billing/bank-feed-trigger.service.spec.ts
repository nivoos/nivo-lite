import { Test } from "@nestjs/testing"
import { mock, mockEntityManager } from "@starci/jest-preset"
import { bankTransactionTriggerFor, feedTransactionRowsOf, type IncomingCredit } from "@modules/domain/bank-feed-inbox"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import { ProviderTriggersService } from "@modules/domain/provider-triggers"
import { BankFeedTriggerService, type AdmittedMovement } from "./bank-feed-trigger.service"

const OWNER = { provider: "sepay", connectionId: "conn-1", workspaceId: "ws-1" }

const credit = (eventId: string, change: Partial<IncomingCredit> = {}): IncomingCredit => ({
    amount: 150_000,
    content: "NIVO8F3K2",
    eventId,
    fallbackBankName: "SePay",
    occurredAt: "2026-11-12T04:00:00Z",
    ...change,
})

/** The admitted movement: the transaction row the feed's intake wrote of this credit (its own normaliser), as the delivery job hands it on. */
const movementOf = (one: IncomingCredit, id = "row-0"): AdmittedMovement => {
    const [row] = feedTransactionRowsOf("sepay-feed", [one], "webhook")
    return { type: "sepay.transaction", id, value: row?.value ?? {} }
}

const build = async (world: { readonly environment?: string } = {}) => {
    const tx = mockEntityManager()
    const connections = mock<ConnectionBindingsReadService>()
    connections.stateOf.mockResolvedValue({ name: "Bank", environment: world.environment ?? "live" })
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockResolvedValue({ status: "delivered", events: 0, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 })
    const moduleRef = await Test.createTestingModule({
        providers: [
            BankFeedTriggerService,
            { provide: ConnectionBindingsReadService, useValue: connections },
            { provide: ProviderTriggersService, useValue: triggers },
        ],
    }).compile()
    return { service: moduleRef.get(BankFeedTriggerService), tx, connections, triggers }
}

describe("BankFeedTriggerService", () => {
    it("hands the admitted movement to the ONE delivery as its feed's trigger translates the stored row, with the row as its inbox", async () => {
        const { service, tx, triggers } = await build()

        await service.emit(tx, OWNER, movementOf(credit("sepay:1", { direction: "debit" })))

        expect(triggers.deliver).toHaveBeenCalledTimes(1)
        expect(triggers.deliver).toHaveBeenCalledWith(
            {
                workspaceId: "ws-1",
                declaration: bankTransactionTriggerFor("sepay"),
                connectionId: "conn-1",
                agentId: null,
                events: [
                    {
                        event: {
                            id: "sepay:1",
                            data: { transactionId: "sepay:1", direction: "out", amountVnd: 150_000, content: "NIVO8F3K2", at: "2026-11-12T04:00:00.000Z", payKey: "NIVO8F3K2" },
                        },
                        raw: { type: "sepay.transaction", id: "row-0" },
                        occurredAt: "2026-11-12T04:00:00.000Z",
                    },
                ],
            },
            tx,
        )
    })

    it("carries no payer in an event and names no person (a movement has no subject)", async () => {
        const { service, tx, triggers } = await build()

        await service.emit(tx, OWNER, movementOf(credit("sepay:1", { payer: "NGUYEN VAN A" })))

        const [delivered] = triggers.deliver.mock.calls[0]?.[0].events ?? []
        expect(Object.keys(delivered?.event.data ?? {})).not.toContain("payer")
        expect(delivered?.event.subject).toBeUndefined()
    })

    it("delivers nothing for a row its trigger cannot read", async () => {
        const { service, tx, triggers } = await build()

        await service.emit(tx, OWNER, { type: "sepay.transaction", id: "row-0", value: { amount: "lots" } })

        expect(triggers.deliver).not.toHaveBeenCalled()
    })

    it("delivers nothing for an account in the provider's test environment, or of a provider that is no bank feed", async () => {
        const test = await build({ environment: "test" })
        await test.service.emit(test.tx, OWNER, movementOf(credit("sepay:1")))
        expect(test.triggers.deliver).not.toHaveBeenCalled()

        const other = await build()
        await other.service.emit(other.tx, { ...OWNER, provider: "imap" }, movementOf(credit("sepay:1")))
        expect(other.triggers.deliver).not.toHaveBeenCalled()
    })

    it("swallows nothing: a failure of the delivery fails the emit, so the delivery job's transaction rolls back and the wake is never lost", async () => {
        const { service, tx, triggers } = await build()
        const down = new Error("down")
        triggers.deliver.mockRejectedValue(down)

        await expect(service.emit(tx, OWNER, movementOf(credit("sepay:1")))).rejects.toBe(down)
        expect(tx.transaction).not.toHaveBeenCalled()
    })
})
