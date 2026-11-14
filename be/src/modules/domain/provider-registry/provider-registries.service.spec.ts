import { Test } from "@nestjs/testing"
import { ProviderRegistryError, ProviderRegistryErrorCode } from "./errors/provider-registry.error"
import type { PollReceiver } from "./provider-ports.contracts"
import * as registries from "./provider-registries.service"
import {
    BankTransactionsRegistryService,
    FeedWebhookRegistryService,
    LedgerRegistryService,
    PaymentInstructionRegistryService,
    PollReceiverRegistryService,
} from "./provider-registries.service"

/** Every registry, each built alone in its own test module. */
const build = async () => {
    const instructions = await Test.createTestingModule({ providers: [PaymentInstructionRegistryService] }).compile()
    const transactions = await Test.createTestingModule({ providers: [BankTransactionsRegistryService] }).compile()
    const webhooks = await Test.createTestingModule({ providers: [FeedWebhookRegistryService] }).compile()
    const receivers = await Test.createTestingModule({ providers: [PollReceiverRegistryService] }).compile()
    const ledgers = await Test.createTestingModule({ providers: [LedgerRegistryService] }).compile()
    return {
        instructions: instructions.get(PaymentInstructionRegistryService),
        transactions: transactions.get(BankTransactionsRegistryService),
        webhooks: webhooks.get(FeedWebhookRegistryService),
        receivers: receivers.get(PollReceiverRegistryService),
        ledgers: ledgers.get(LedgerRegistryService),
    }
}

/** A poll receiver of a provider with inert reads: the registry only holds it. */
const receiverOf = (provider: string, dataType: string): PollReceiver => ({
    provider,
    dataType,
    limits: { ratePerSecond: 1, burst: 1, concurrency: 1 },
    cadence: { aloneMs: 300_000, besideWebhookMs: 1_800_000 },
    read: () => Promise.resolve({ kind: "skipped", reason: "no_token" }),
    classify: () => ({ kind: "transient" }),
})

describe("the registries of the provider capabilities", () => {
    it("start empty, each on its own", async () => {
        const all = await build()

        for (const registry of Object.values(all)) expect(registry.providers()).toEqual([])
    })

    it("keep the registrations of one capability apart from the others", async () => {
        const { instructions, transactions } = await build()
        const port = { provider: "sepay", qrUrl: () => "qr", transfer: () => Promise.reject(new ProviderRegistryError({ code: ProviderRegistryErrorCode.CallNotSent })) }

        instructions.register(port)

        expect(instructions.liveOf("sepay")).toBe(port)
        expect(transactions.has("sepay")).toBe(false)
    })

    it("no longer hold a registry of bank feed pollers or message inbox pollers: the poll receiver registry is the one", () => {
        expect(Object.keys(registries).sort()).toEqual([
            "BankTransactionsRegistryService",
            "ChannelProfileRegistryService",
            "DomainRegistrarRegistryService",
            "FeedWebhookRegistryService",
            "LedgerRegistryService",
            "PaymentInstructionRegistryService",
            "PollReceiverRegistryService",
        ])
    })
})

describe("PollReceiverRegistryService", () => {
    it("serves a live account its provider's live receiver and a sandbox account the sandbox twin, one receiver per provider", async () => {
        const { receivers } = await build()
        const live = receiverOf("sepay", "sepay.transaction")
        const sandbox = receiverOf("sepay", "sepay.transaction")

        receivers.register({ live, sandbox })

        expect(receivers.has("sepay")).toBe(true)
        expect(receivers.providers()).toEqual(["sepay"])
        expect(receivers.portFor({ provider: "sepay", sandbox: false })).toBe(live)
        expect(receivers.portFor({ provider: "sepay", sandbox: true })).toBe(sandbox)
        expect(receivers.liveOf("sepay")).toBe(live)
    })

    it("refuses a sandbox account of a provider that registered no sandbox twin, never answering the live receiver", async () => {
        const { receivers } = await build()
        receivers.register(receiverOf("sepay", "sepay.transaction"))

        expect(() => receivers.portFor({ provider: "sepay", sandbox: true })).toThrow(
            expect.objectContaining({ code: ProviderRegistryErrorCode.SandboxMissing }),
        )
    })

    it("refuses a pair that names two providers", async () => {
        const { receivers } = await build()

        expect(() => receivers.register({ live: receiverOf("sepay", "sepay.transaction"), sandbox: receiverOf("casso", "casso.transaction") })).toThrow(
            expect.objectContaining({ code: ProviderRegistryErrorCode.SandboxMismatch }),
        )
    })

    it("answers nothing for a provider that has no receiver", async () => {
        const { receivers } = await build()

        expect(receivers.has("telegram")).toBe(false)
        expect(receivers.portFor({ provider: "telegram", sandbox: false })).toBeUndefined()
    })
})
