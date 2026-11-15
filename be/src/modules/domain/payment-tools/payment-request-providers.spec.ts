import { TOOL } from "@nivo-lite/agent-sdk/names"
import { mock } from "@starci/jest-preset"
import type { ConnectionsService } from "@modules/domain/connections"
import { PaymentRequestRegistryService, type BankTransactionsRegistryService, type PollReceiverRegistryService } from "@modules/domain/provider-registry"
import type { SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import { PayosProviderRegistrationService } from "@modules/domain/payos-provider/payos-provider-registration.service"
import { PayosPaymentRequestAdapter } from "@modules/domain/payos-provider/payos-payment-request.adapter"
import type { PayosPaymentLinkService } from "@modules/domain/payos-provider/payos-payment-link.service"
import type { PayosSandboxPaymentLinkService } from "@modules/domain/payos-provider/payos-sandbox-payment-link.service"
import { SepayProviderRegistrationService } from "@modules/domain/sepay-provider/sepay-provider-registration.service"
import type { SepayPaymentInstructionService } from "@modules/domain/sepay-provider/sepay-payment-instruction.service"
import type { SepaySandboxPaymentInstructionService } from "@modules/domain/sepay-provider/sepay-sandbox-payment-instruction.service"
import { toolSpecOf } from "@modules/domain/tool-specs"
import { PROVIDER_CATALOGUE } from "@modules/domain/tools"

/**
 * THE GATE of the one payment request (owner ruling R111, fixing rule 9): every provider that owns the `nivo.tool.payment.request.*` purpose
 * (its tool specs, its abilities) registers a `PaymentRequestPort`, live AND sandbox, through its REAL registration service, and no provider
 * registers one it does not own. A money provider that serves no request is named here with why. A provider added to the owners without an
 * adapter, or an adapter left without the declaration, turns this red.
 */

/** The money providers that serve no payment request, each with why. */
const NO_REQUEST: Readonly<Record<string, string>> = {
    casso: "a bank feed of received credits only (credit reads); it composes and creates nothing a payer pays",
}

const REQUEST_TOOLS = [TOOL.paymentRequestCreate, TOOL.paymentRequestGet, TOOL.paymentRequestCancel] as const

/** The registry after both providers' real registration ran (everything else they register is a double). */
const registered = (): PaymentRequestRegistryService => {
    const requests = new PaymentRequestRegistryService()
    const connections = mock<ConnectionsService>()
    connections.siteBase.mockReturnValue("https://app.example.vn")
    new PayosProviderRegistrationService(
        requests,
        mock<PayosPaymentLinkService>({ provider: "payos" }),
        mock<PayosSandboxPaymentLinkService>({ provider: "payos" }),
        connections,
        mock<SandboxCatalogueRegistryService>(),
    ).onModuleInit()
    new SepayProviderRegistrationService(
        mock<PollReceiverRegistryService>(),
        mock<BankTransactionsRegistryService>(),
        requests,
        mock(),
        mock(),
        mock<SepayPaymentInstructionService>({ provider: "sepay" }),
        mock(),
        mock(),
        mock<SepaySandboxPaymentInstructionService>({ provider: "sepay" }),
        mock<SandboxCatalogueRegistryService>(),
    ).onModuleInit()
    return requests
}

describe("the payment-request gate (R111)", () => {
    it("the three tools have ONE owner list, and exactly those providers register the port, live and sandbox", () => {
        const owners = REQUEST_TOOLS.map((tool) => [...(toolSpecOf(tool)?.owners ?? [])].sort())
        expect(new Set(owners.map((list) => list.join(","))).size).toBe(1)
        const requests = registered()
        expect([...requests.providers()].sort()).toEqual(owners[0])
        for (const provider of requests.providers()) {
            expect(requests.portFor({ provider, sandbox: false })).toBeDefined()
            expect(requests.portFor({ provider, sandbox: true })).toBeDefined()
        }
    })

    it("every provider whose abilities name a payment-request tool serves the port; every other money provider is named with why", () => {
        const requests = registered()
        const requesting = PROVIDER_CATALOGUE.filter((spec) => spec.abilities.some((ability) => ability.tools.some((tool) => REQUEST_TOOLS.includes(tool as never))))
        for (const spec of requesting) {
            expect(requests.has(spec.provider)).toBe(true)
            const tools = spec.abilities.flatMap((ability) => ability.tools)
            for (const tool of REQUEST_TOOLS) expect(tools).toContain(tool)
        }
        const silent = PROVIDER_CATALOGUE.filter((spec) => spec.kind === "payment" && !requests.has(spec.provider)).map((spec) => spec.provider)
        expect(silent.sort()).toEqual(Object.keys(NO_REQUEST).sort())
    })

    it("payOS's live and sandbox ports are its adapter over its own link services; a port keeps get / cancel exactly when the provider keeps request state", () => {
        const requests = registered()
        expect(requests.portFor({ provider: "payos", sandbox: false })).toBeInstanceOf(PayosPaymentRequestAdapter)
        expect(requests.portFor({ provider: "payos", sandbox: true })).toBeInstanceOf(PayosPaymentRequestAdapter)
        expect(typeof requests.portFor({ provider: "payos", sandbox: false })?.cancel).toBe("function")
        expect(requests.portFor({ provider: "sepay", sandbox: false })?.cancel).toBeUndefined()
    })

    it("declares the tools as the rule says: create a repeatable write, get a read, cancel a write confirmed by get and final on no_request_state", () => {
        expect(toolSpecOf(TOOL.paymentRequestCreate)).toMatchObject({ mutates: true, repeatable: true, account: "any" })
        expect(toolSpecOf(TOOL.paymentRequestGet)).toMatchObject({ mutates: false, repeatable: true })
        expect(toolSpecOf(TOOL.paymentRequestCancel)).toMatchObject({
            mutates: true,
            repeatable: false,
            finalRefusals: ["no_request_state"],
            confirmBy: { tool: TOOL.paymentRequestGet, args: { requestRef: { from: "args", member: "requestRef" } }, happened: { member: "status", equals: "cancelled" } },
        })
    })
})
