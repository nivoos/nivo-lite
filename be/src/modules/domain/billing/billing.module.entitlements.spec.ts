import { BillingModule } from "./billing.module"
import { BankFeedService } from "./bank-feed.service"
import { BillingService } from "./billing.service"
import { EntitlementsService } from "./entitlements.service"

const OPTIONS = { sepayApiKey: undefined, bankAccount: { account: "", bank: "", holder: "" } }

describe("BillingModule entitlements only (the mcp app: a file upload's storage room, no payment, no bank feed)", () => {
    it("registers the plan's entitlements and the billing reads they stand on, and none of the bank feed", () => {
        const module = BillingModule.registerEntitlements(OPTIONS)
        const providers = module.providers ?? []

        expect(providers).toContain(EntitlementsService)
        expect(providers).toContain(BillingService)
        expect(providers).not.toContain(BankFeedService)
        expect(module.exports).toEqual([EntitlementsService])
    })
})
