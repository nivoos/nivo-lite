import { mock } from "@starci/jest-preset"
import type { ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import { ProviderSandboxAccountsService, ProviderSandboxErrorCode, ProviderSandboxService, SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { MemoryProviderSandboxStore, RecordingWebhookPoster, sandboxAccount } from "@tests/fixtures/builders/provider-sandbox.builder"
import { PAYOS_SANDBOX_CATALOGUE, payosSandboxLinkAccountOf, payosSandboxLinkId } from "./payos-sandbox.catalogue"
import { PayosSandboxPaymentLinkService } from "./payos-sandbox-payment-link.service"

const ACTOR = { principalId: "user-1", workspaceId: "ws-1" }
const NOW = new Date("2026-11-14T08:00:00.000Z")
const ORIGIN = "https://app.nivo.test"
const ONE = connectionRecord({ id: "11111111-1111-4111-8111-111111111111", workspaceId: "ws-1", provider: "payos", name: "PayOS thử", sandbox: true })
const TWO = connectionRecord({ id: "22222222-2222-4222-8222-222222222222", workspaceId: "ws-1", provider: "payos", name: "PayOS hai", sandbox: true })
const LIVE = connectionRecord({ id: "33333333-3333-4333-8333-333333333333", workspaceId: "ws-1", provider: "payos", name: "PayOS thật" })
const REQUEST = { amountVnd: 150000, description: "DH001", returnUrl: "https://shop.example/paid", cancelUrl: "https://shop.example/cancelled" }

/** The real payOS sandbox twin, the real catalogue and the real doors over a memory store; only the connections and the webhook poster are doubles. */
const setup = (options: { readonly origin?: string | undefined; readonly enabled?: boolean } = {}) => {
    const records: ReadonlyArray<ConnectionRecord> = [ONE, TWO, LIVE]
    const connections = mock<ConnectionsService>()
    connections.authorize.mockResolvedValue({ role: "owner", displayName: "Lan" })
    connections.find.mockImplementation((workspaceId, id) => Promise.resolve(records.find((one) => one.id === id && one.workspaceId === workspaceId) ?? null))
    connections.sandboxKeyOf.mockResolvedValue("sbx_key")
    const store = new MemoryProviderSandboxStore()
    store.open(sandboxAccount({ id: ONE.id, workspaceId: "ws-1", provider: "payos" }))
    store.open(sandboxAccount({ id: TWO.id, workspaceId: "ws-1", provider: "payos" }))
    const sandbox = new ProviderSandboxService(store, { enabled: options.enabled ?? true }, options.origin)
    const catalogues = new SandboxCatalogueRegistryService()
    catalogues.register(PAYOS_SANDBOX_CATALOGUE)
    const poster = new RecordingWebhookPoster()
    const doors = new ProviderSandboxAccountsService(connections, sandbox, catalogues, poster, { now: () => NOW })
    return { doors, poster, port: new PayosSandboxPaymentLinkService(sandbox), sandbox, store }
}

describe("payOS sandbox pay links on the Sandbox page (SBX-6)", () => {
    it("builds the checkout address on NIVO's own pay page of the account's workspace when a web origin is known, else on the reserved host", async () => {
        const withOrigin = await setup({ origin: `${ORIGIN}/` }).port.create(ONE, REQUEST)
        const without = await setup().port.create(ONE, REQUEST)

        expect(withOrigin.checkoutUrl).toBe(`${ORIGIN}/workspaces/ws-1/sandbox/pay/${withOrigin.linkId}`)
        expect(withOrigin.linkId).toBe(`sbx-payos-${ONE.id}-000001`)
        expect(without.checkoutUrl).toBe(`https://sandbox.invalid/pay/${without.linkId}`)
    })

    it("names its account in the link id: two accounts never share an id, and the id alone finds its own account's link", async () => {
        const { doors, port } = setup({ origin: ORIGIN })
        const first = await port.create(ONE, REQUEST)
        const other = await port.create(TWO, { ...REQUEST, amountVnd: 99000, description: "DH002" })

        expect(first.linkId).not.toBe(other.linkId)
        expect(payosSandboxLinkAccountOf(first.linkId)).toBe(ONE.id)
        expect(payosSandboxLinkAccountOf("not-a-sandbox-id")).toBeNull()
        const one = await doors.payLink(ACTOR, first.linkId)
        const two = await doors.payLink(ACTOR, other.linkId)
        expect(one).toMatchObject({ account: { id: ONE.id, provider: "payos", label: "PayOS thử" }, amountVnd: 150000, content: "DH001" })
        expect(two).toMatchObject({ account: { id: TWO.id, label: "PayOS hai" }, amountVnd: 99000, content: "DH002" })
    })

    it("answers an open link: the amount, the content, the order code, its state, the paying case and the inputs it gives the case", async () => {
        const { doors, port } = setup()
        const link = await port.create(ONE, REQUEST)

        await expect(doors.payLink(ACTOR, link.linkId)).resolves.toEqual({
            account: { id: ONE.id, provider: "payos", label: "PayOS thử" },
            linkId: link.linkId,
            amountVnd: 150000,
            content: "DH001",
            orderCode: "1780000000001",
            status: "open",
            amountReceivedVnd: 0,
            caseIds: ["PAYOS-3"],
            inputs: { orderCode: 1780000000001 },
        })
    })

    it("marks the link paid when its case is sent from the page (the amount received kept, no case applies any more, the port reads it PAID)", async () => {
        const { doors, poster, port } = setup()
        const link = await port.create(ONE, REQUEST)
        const view = await doors.payLink(ACTOR, link.linkId)

        const sent = await doors.send(ACTOR, ONE.id, view.caseIds[0] ?? "", { orderCode: Number(view.orderCode) })

        expect(sent.deliveries).toHaveLength(1)
        expect(poster.posts[0]?.body).toMatchObject({ data: { orderCode: 1780000000001, amount: 150000, paymentLinkId: link.linkId } })
        await expect(doors.payLink(ACTOR, link.linkId)).resolves.toMatchObject({ status: "paid", amountReceivedVnd: 150000, caseIds: [] })
        expect(await port.get(ONE, { linkId: link.linkId })).toMatchObject({ status: "PAID", amountPaidVnd: 150000, amountRemainingVnd: 0 })
        const second = await doors.send(ACTOR, ONE.id, "PAYOS-3", { orderCode: Number(view.orderCode) })
        expect(second.deliveries).toHaveLength(1)
        await expect(doors.payLink(ACTOR, link.linkId)).resolves.toMatchObject({ status: "paid", amountReceivedVnd: 150000 })
    })

    it("pays only the link the order code names; the account's other link stays open", async () => {
        const { doors, port } = setup()
        await port.create(ONE, REQUEST)
        const second = await port.create(ONE, { ...REQUEST, description: "DH002" })

        await doors.send(ACTOR, ONE.id, "PAYOS-3", { orderCode: second.orderCode })

        await expect(doors.payLink(ACTOR, `sbx-payos-${ONE.id}-000001`)).resolves.toMatchObject({ status: "open" })
        await expect(doors.payLink(ACTOR, second.linkId)).resolves.toMatchObject({ status: "paid" })
    })

    it("a payment short of the amount leaves the link open with what was received kept (the case ids still apply)", async () => {
        const { doors, port, store } = setup()
        const link = await port.create(ONE, REQUEST)
        const kept = await port.get(ONE, { linkId: link.linkId })
        await store.keepState(sandboxAccount({ id: ONE.id, workspaceId: "ws-1", provider: "payos" }), "link", link.linkId, { ...kept, amountPaidVnd: 50000, amountRemainingVnd: 100000 })

        await expect(doors.payLink(ACTOR, link.linkId)).resolves.toMatchObject({ status: "open", amountVnd: 150000, amountReceivedVnd: 50000, caseIds: ["PAYOS-3"] })
    })

    it("tells a cancelled link and an expired one, neither takes a case; a late payment on a cancelled link leaves it cancelled", async () => {
        const { doors, port } = setup()
        const cancelled = await port.create(ONE, REQUEST)
        await port.cancel(ONE, { linkId: cancelled.linkId }, "changed mind")
        const lapsed = await port.create(ONE, { ...REQUEST, expiresAt: "2026-11-14T07:00:00.000Z" })
        const running = await port.create(ONE, { ...REQUEST, expiresAt: "2026-11-14T09:00:00.000Z" })

        await expect(doors.payLink(ACTOR, cancelled.linkId)).resolves.toMatchObject({ status: "cancelled", caseIds: [] })
        await expect(doors.payLink(ACTOR, lapsed.linkId)).resolves.toMatchObject({ status: "expired", caseIds: [] })
        await expect(doors.payLink(ACTOR, running.linkId)).resolves.toMatchObject({ status: "open", caseIds: ["PAYOS-3"] })
        await doors.send(ACTOR, ONE.id, "PAYOS-3", { orderCode: Number(cancelled.orderCode) })
        await doors.send(ACTOR, ONE.id, "PAYOS-3", { orderCode: Number(lapsed.orderCode) })
        await expect(doors.payLink(ACTOR, cancelled.linkId)).resolves.toMatchObject({ status: "cancelled" })
        await expect(doors.payLink(ACTOR, lapsed.linkId)).resolves.toMatchObject({ status: "expired" })
    })

    it("refuses an id the sandbox never issued, a link the account never made, another workspace's link and a live account's id", async () => {
        const { doors, port } = setup()
        const link = await port.create(ONE, REQUEST)

        await expect(doors.payLink(ACTOR, "nope")).rejects.toMatchObject({ code: ProviderSandboxErrorCode.PayLinkUnknown, params: { linkId: "nope" } })
        await expect(doors.payLink(ACTOR, payosSandboxLinkId(ONE.id, 9))).rejects.toMatchObject({ code: ProviderSandboxErrorCode.PayLinkUnknown })
        await expect(doors.payLink({ ...ACTOR, workspaceId: "ws-2" }, link.linkId)).rejects.toMatchObject({ code: ProviderSandboxErrorCode.PayLinkUnknown })
        await expect(doors.payLink(ACTOR, payosSandboxLinkId(LIVE.id, 1))).rejects.toMatchObject({ code: ProviderSandboxErrorCode.LiveAccount })
    })

    it("is closed when the dev switch is OFF", async () => {
        const { doors } = setup({ enabled: false })
        await expect(doors.payLink(ACTOR, payosSandboxLinkId(ONE.id, 1))).rejects.toMatchObject({ code: ProviderSandboxErrorCode.Off })
    })
})
