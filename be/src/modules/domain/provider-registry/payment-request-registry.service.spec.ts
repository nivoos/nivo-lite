import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { PaymentRequestRegistryService } from "./payment-request-registry.service"
import type { PaymentRequestPort } from "./payment-request-ports.contracts"

describe("PaymentRequestRegistryService", () => {
    const build = async () => {
        const moduleRef = await Test.createTestingModule({ providers: [PaymentRequestRegistryService] }).compile()
        return moduleRef.get(PaymentRequestRegistryService)
    }

    it("starts with no provider and answers undefined for a key nobody registered", async () => {
        const registry = await build()

        expect(registry.providers()).toEqual([])
        expect(registry.has("payos")).toBe(false)
        expect(registry.liveOf("payos")).toBeUndefined()
    })

    it("finds a registered provider by its key, and a second registration under the key replaces the first", async () => {
        const registry = await build()
        const first = mock<PaymentRequestPort>({ provider: "payos" })
        const second = mock<PaymentRequestPort>({ provider: "payos" })

        registry.register(first)
        expect(registry.liveOf("payos")).toBe(first)
        registry.register(second)

        expect(registry.liveOf("payos")).toBe(second)
        expect(registry.providers()).toHaveLength(1)
        expect(registry.liveOf(registry.providers()[0] ?? "")).toBe(second)
    })
})
