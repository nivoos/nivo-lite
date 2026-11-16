import { mock } from "@starci/jest-preset"
import { bankTransactionTriggerFor, bankTransactionValueOf } from "@modules/domain/bank-feed-inbox"
import { payosBodyOf, readPayosDelivery } from "@modules/domain/billing/payos.policy"
import type { ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import { proofOf, providerRefusalReason } from "@modules/domain/provider-registry"
import { ProviderSandboxAccountsService, SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { RecordingWebhookPoster, sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { PAY_RETURN_PATH, PAYOS_DESCRIPTION_MAX, PayosPaymentRequestAdapter, payosDescriptionOf, payosStatusOf } from "./payos-payment-request.adapter"
import { PAYOS_SANDBOX_CASE, PAYOS_SANDBOX_CATALOGUE } from "./payos-sandbox.catalogue"
import { PayosSandboxPaymentLinkService } from "./payos-sandbox-payment-link.service"

const ACCOUNT = sandboxAccount({ id: "conn-p", workspaceId: "ws-1", provider: "payos" })
const CONNECTION: ConnectionRecord = connectionRecord({ id: "conn-p", workspaceId: "ws-1", provider: "payos", sandbox: true })
const ACTOR = { principalId: "user-1", workspaceId: "ws-1" }
const SITE = "https://app.example.vn"
const ASK = { amountVnd: 150000, reference: "DH-20261113-0001" }

/**
 * payOS's payment-request adapter over payOS's REAL sandbox link service (the frame, the catalogue, no host, no secret): the request a node
 * makes on a payOS sandbox account, and the inbound cases that move it, as the Sandbox page sends them.
 */
const setup = () => {
    const { sandbox } = sandboxServiceOf(ACCOUNT)
    const links = new PayosSandboxPaymentLinkService(sandbox)
    const connections = mock<ConnectionsService>()
    connections.authorize.mockResolvedValue({ role: "owner", displayName: "Lan" })
    connections.find.mockResolvedValue(CONNECTION)
    connections.sandboxKeyOf.mockResolvedValue("sbx_key_1")
    const catalogues = new SandboxCatalogueRegistryService()
    catalogues.register(PAYOS_SANDBOX_CATALOGUE)
    const poster = new RecordingWebhookPoster()
    const doors = new ProviderSandboxAccountsService(connections, sandbox, catalogues, poster, { now: () => new Date("2026-11-15T03:00:00.000Z") })
    return { sandbox, links, doors, poster, adapter: new PayosPaymentRequestAdapter(links, () => SITE) }
}

const thrownOf = (run: Promise<unknown>): Promise<unknown> => run.catch((cause: unknown) => cause)

describe("PayosPaymentRequestAdapter (R111) on a payOS sandbox account", () => {
    it("PAYOS-1: the request is a hosted link: a pay page, a QR payload (never a picture), payOS's order code as the reference and the key", async () => {
        const { adapter, sandbox } = setup()

        const request = await adapter.create(CONNECTION, ASK)

        expect(request).toEqual({
            amountVnd: 150000,
            reference: "DH-20261113-0001",
            status: "open",
            payUrl: "https://sandbox.invalid/pay/sbx-payos-conn-p-000001",
            qrPayload: "00020101021238570010A000000727sandbox",
            requestRef: "1780000000001",
            payKey: "1780000000001",
        })
        expect(request).not.toHaveProperty("qrImageUrl")
        // payOS gets the environment's return page for both addresses and a description within its 9-character limit.
        const [call] = await sandbox.calls(ACCOUNT, "create")
        expect(call?.request).toEqual({ amountVnd: 150000, description: "611130001", returnUrl: `${SITE}${PAY_RETURN_PATH}`, cancelUrl: `${SITE}${PAY_RETURN_PATH}` })
    })

    it("fits every reference into payOS's 9 characters (letters and digits, the end kept) and maps payOS's words to the neutral status", () => {
        expect(payosDescriptionOf("DH-20261113-0001")).toBe("611130001")
        expect(payosDescriptionOf("DH001")).toBe("DH001")
        expect(payosDescriptionOf("x".repeat(94)).length).toBe(PAYOS_DESCRIPTION_MAX)
        expect(["PENDING", "PROCESSING", "PAID", "CANCELLED", "EXPIRED", "SOMETHING"].map(payosStatusOf)).toEqual(["open", "open", "paid", "cancelled", "expired", "open"])
    })

    it("PAYOS-2: a refused create is the provider's refusal (rejected, no proof): the tool answers it, nothing was made", async () => {
        const { adapter, sandbox } = setup()
        await sandbox.setNextCase(ACCOUNT, "create", PAYOS_SANDBOX_CASE.createRefused)

        const thrown = await thrownOf(adapter.create(CONNECTION, ASK))

        expect([providerRefusalReason(thrown), proofOf(thrown)]).toEqual(["rejected", null])
    })

    it("PAYOS-12 / PAYOS-19: a create whose answer was lost proves `unknown`; making the same ask again gives a NEW request, the lost one was never shown to a payer", async () => {
        const { adapter, sandbox } = setup()
        await sandbox.setNextCase(ACCOUNT, "create", PAYOS_SANDBOX_CASE.createTimeoutApplied)

        expect(proofOf(await thrownOf(adapter.create(CONNECTION, ASK)))).toBe("unknown")
        await sandbox.setNextCase(ACCOUNT, "create", PAYOS_SANDBOX_CASE.created)
        const again = await adapter.create(CONNECTION, ASK)

        // The tool is declared repeatable: the engine makes the recorded ask again; the order keeps the request whose answer came back.
        expect(again.requestRef).toBe("1780000000002")
        expect((await adapter.get(CONNECTION, again.requestRef ?? "")).status).toBe("open")
    })

    it("PAYOS-4 / PAYOS-5: reads the request by its reference and cancels it; PAYOS-20 (cancel answer lost, the link WAS cancelled) confirms by the read", async () => {
        const { adapter, sandbox } = setup()
        const first = await adapter.create(CONNECTION, ASK)
        const second = await adapter.create(CONNECTION, ASK)

        expect(await adapter.get(CONNECTION, first.requestRef ?? "")).toMatchObject({ requestRef: "1780000000001", status: "open", providerStatus: "PENDING" })
        expect(await adapter.cancel(CONNECTION, first.requestRef ?? "", "changed")).toMatchObject({ status: "cancelled", providerStatus: "CANCELLED" })
        await sandbox.setNextCase(ACCOUNT, "cancel", PAYOS_SANDBOX_CASE.cancelTimeoutApplied)
        expect(proofOf(await thrownOf(adapter.cancel(CONNECTION, second.requestRef ?? "", undefined)))).toBe("unknown")
        // What `confirmBy` reads: the request's status is `cancelled`, so the cancel HAPPENED.
        expect((await adapter.get(CONNECTION, second.requestRef ?? "")).status).toBe("cancelled")
    })

    it("PAYOS-6 / PAYOS-7: a request the provider does not hold is not_found; a reference that is no order code is held by nobody", async () => {
        const { adapter, sandbox } = setup()
        await adapter.create(CONNECTION, ASK)
        expect(providerRefusalReason(await thrownOf(adapter.get(CONNECTION, "1789999999999")))).toBe("not_found")
        expect(providerRefusalReason(await thrownOf(adapter.get(CONNECTION, "DH-20261113-0001")))).toBe("not_found")
        await sandbox.setNextCase(ACCOUNT, "cancel", PAYOS_SANDBOX_CASE.cancelRefused)
        expect(providerRefusalReason(await thrownOf(adapter.cancel(CONNECTION, "1780000000001", undefined)))).toBe("rejected")
    })

    it("PAYOS-9 / PAYOS-10: the payer cancels at checkout, or the request lapses: no webhook, the next read says so", async () => {
        const { adapter, doors, poster } = setup()
        const cancelled = await adapter.create(CONNECTION, ASK)
        const lapsed = await adapter.create(CONNECTION, ASK)

        await doors.send(ACTOR, CONNECTION.id, "PAYOS-9", { orderCode: Number(cancelled.requestRef) })
        await doors.send(ACTOR, CONNECTION.id, "PAYOS-10", { orderCode: Number(lapsed.requestRef) })

        expect(poster.posts).toEqual([])
        expect((await adapter.get(CONNECTION, cancelled.requestRef ?? "")).status).toBe("cancelled")
        expect((await adapter.get(CONNECTION, lapsed.requestRef ?? "")).status).toBe("expired")
    })

    it("PAYOS-3: the paid webhook of the request becomes a bank movement whose payKey IS the request's payKey (matched by the order code, never by the 9-character words)", async () => {
        const { adapter, doors, poster } = setup()
        const request = await adapter.create(CONNECTION, ASK)

        await doors.send(ACTOR, CONNECTION.id, "PAYOS-3", { orderCode: Number(request.requestRef) })

        const [post] = poster.posts
        const reading = readPayosDelivery(payosBodyOf(post?.body as never))
        expect(reading).toMatchObject({ kind: "credit", amount: 150000, content: "611130001", requestRef: request.requestRef })
        if (reading.kind !== "credit") throw new Error("no credit")
        const row = bankTransactionValueOf({ ...reading, fallbackBankName: "payOS" }, "webhook")
        const event = bankTransactionTriggerFor("payos")?.translate(row as never, { connectionId: CONNECTION.id })
        expect(event?.data).toMatchObject({ direction: "in", amountVnd: 150000, payKey: request.payKey })
        expect((await adapter.get(CONNECTION, request.requestRef ?? "")).status).toBe("paid")
    })
})
