import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { ConnectionsService, type ConnectionRecord } from "@modules/domain/connections"
import type { NativeCaller } from "@modules/domain/tools"
import {
    PaymentRequestRegistryService,
    providerCallFailure,
    providerRefusal,
    type PaymentRequest,
    type PaymentRequestPort,
    type PaymentRequestState,
} from "@modules/domain/provider-registry"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { REQUEST_CANCEL_SCHEMA, REQUEST_CREATE_SCHEMA, REQUEST_GET_SCHEMA, REQUEST_REFERENCE_MAX } from "./payment-request.schema"
import { PAYMENT_REQUEST_MANIFEST, PAYMENT_REQUEST_TOOL, PaymentRequestNativeService } from "./payment-request-native.service"

const PAYOS: ConnectionRecord = connectionRecord({ id: "conn-payos", provider: "payos", name: "Pay" })
const SEPAY: ConnectionRecord = connectionRecord({ id: "conn-sepay", provider: "sepay", name: "Bank" })

const caller = (connectionId?: string): NativeCaller => ({
    agentId: "agent-1",
    conversationId: null,
    ...(connectionId === undefined ? {} : { connectionId }),
})

/** A payOS request as its adapter answers it: a pay page, a QR payload, its order code as the reference and the key. */
const LINK: PaymentRequest = {
    amountVnd: 150000,
    reference: "DH-20261113-0001",
    status: "open",
    payUrl: "https://pay.payos.vn/web/124c33293c43417ab7879e14c8d9eb18",
    qrPayload: "00020101021238570010A000000727",
    requestRef: "1789000000001",
    payKey: "1789000000001",
}

/** A SePay request as its adapter answers it: a QR picture, the bank details, the words to write; no request kept. */
const INSTRUCTION: PaymentRequest = {
    amountVnd: 150000,
    reference: "DH-20261113-0001",
    status: "open",
    qrImageUrl: "https://vietqr.app/img?acc=9988776655&bank=VCB&amount=150000&des=DH-20261113-0001",
    transferContent: "DH-20261113-0001",
    payKey: "DH-20261113-0001",
    bank: { accountNumber: "9988776655", code: "VCB" },
}

const STATE: PaymentRequestState = { requestRef: "1789000000001", amountVnd: 150000, amountPaidVnd: 0, status: "open", providerStatus: "PENDING" }

const build = async () => {
    const connections = mock<ConnectionsService>()
    connections.find.mockImplementation((_ws: string, id: string) => Promise.resolve(id === PAYOS.id ? PAYOS : id === SEPAY.id ? SEPAY : null))
    const payos = mock<PaymentRequestPort>({ provider: "payos" })
    payos.create.mockResolvedValue(LINK)
    const payosGet = jest.fn<Promise<PaymentRequestState>, [ConnectionRecord, string]>().mockResolvedValue(STATE)
    const payosCancel = jest
        .fn<Promise<PaymentRequestState>, [ConnectionRecord, string, string | undefined]>()
        .mockResolvedValue({ ...STATE, status: "cancelled", providerStatus: "CANCELLED", cancelledAt: "2026-11-13T10:05:00+07:00" })
    const payosPort: PaymentRequestPort = { provider: "payos", create: payos.create, get: payosGet, cancel: payosCancel }
    // SePay keeps no request: its port has `create` only (the absence of get / cancel IS the declaration).
    const sepayCreate = jest.fn<Promise<PaymentRequest>, [ConnectionRecord, { amountVnd: number; reference: string }]>().mockResolvedValue(INSTRUCTION)
    const sepayPort: PaymentRequestPort = { provider: "sepay", create: sepayCreate }
    const registry = new PaymentRequestRegistryService()
    registry.register(payosPort)
    registry.register(sepayPort)
    const moduleRef = await Test.createTestingModule({
        providers: [
            PaymentRequestNativeService,
            { provide: ConnectionsService, useValue: connections },
            { provide: PaymentRequestRegistryService, useValue: registry },
        ],
    }).compile()
    return { service: moduleRef.get(PaymentRequestNativeService), payosCreate: payos.create, payosGet, payosCancel, sepayCreate, connections }
}

const paramsOf = (work: Promise<unknown>): Promise<unknown> =>
    Promise.resolve(
        work.then(
            () => null,
            (cause: unknown) => (typeof cause === "object" && cause !== null && "params" in cause ? cause.params : undefined) ?? cause,
        ),
    )

const ASK = { amountVnd: 150000, reference: "DH-20261113-0001" }

describe("the payment-request manifest (R111)", () => {
    it("names ONE purpose under nivo.tool, internal only: create and cancel write (ask), get reads; no provider in any name", () => {
        expect(PAYMENT_REQUEST_MANIFEST.tools.map((tool) => tool.domain)).toEqual([
            "nivo.tool.payment.request.create",
            "nivo.tool.payment.request.get",
            "nivo.tool.payment.request.cancel",
        ])
        expect(PAYMENT_REQUEST_MANIFEST.tools.map((tool) => [tool.scope, tool.defaultMode])).toEqual([
            ["write", "ask"],
            ["read", "auto"],
            ["write", "ask"],
        ])
        for (const tool of PAYMENT_REQUEST_MANIFEST.tools) {
            expect(`${PAYMENT_REQUEST_MANIFEST.namespace ?? ""}.${tool.name}`).toBe(tool.domain)
            expect(tool.internalOnly).toBe(true)
            expect(tool.name).not.toMatch(/sepay|payos|casso|link|transfer/u)
        }
    })

    it("takes a positive whole amount and a bounded reference, a request reference, nothing else", () => {
        expect(REQUEST_CREATE_SCHEMA.safeParse(ASK).success).toBe(true)
        expect(REQUEST_CREATE_SCHEMA.safeParse({ ...ASK, amountVnd: 0 }).success).toBe(false)
        expect(REQUEST_CREATE_SCHEMA.safeParse({ ...ASK, reference: "x".repeat(REQUEST_REFERENCE_MAX + 1) }).success).toBe(false)
        expect(REQUEST_CREATE_SCHEMA.safeParse({ ...ASK, expiresAt: "2026-11-20T09:00:00+07:00" }).success).toBe(true)
        expect(REQUEST_CREATE_SCHEMA.safeParse({ ...ASK, returnUrl: "https://x" }).success).toBe(false)
        expect(REQUEST_GET_SCHEMA.safeParse({ requestRef: "1" }).success).toBe(true)
        expect(REQUEST_GET_SCHEMA.safeParse({}).success).toBe(false)
        expect(REQUEST_CANCEL_SCHEMA.safeParse({ requestRef: "1", reason: "changed" }).success).toBe(true)
    })
})

describe("PaymentRequestNativeService: one call, the provider is the account's", () => {
    it("asks the payOS account's port and answers its pay link, QR payload, reference and key, no more", async () => {
        const { service, payosCreate, sepayCreate } = await build()
        const answer = await service.invoke("ws-1", PAYMENT_REQUEST_TOOL.create, ASK, caller("conn-payos"))
        expect(payosCreate).toHaveBeenCalledWith(PAYOS, ASK)
        expect(sepayCreate).not.toHaveBeenCalled()
        expect(answer).toEqual(LINK)
        expect(answer).not.toHaveProperty("qrImageUrl")
    })

    it("asks the SePay account's port with the SAME call and answers its picture, bank details and words; no reference", async () => {
        const { service, sepayCreate, payosCreate } = await build()
        const answer = await service.invoke("ws-1", PAYMENT_REQUEST_TOOL.create, ASK, caller("conn-sepay"))
        expect(sepayCreate).toHaveBeenCalledWith(SEPAY, ASK)
        expect(payosCreate).not.toHaveBeenCalled()
        expect(answer).toEqual(INSTRUCTION)
        expect(answer).not.toHaveProperty("requestRef")
    })

    it("reads and cancels a kept request by its reference", async () => {
        const { service, payosGet, payosCancel } = await build()
        expect(await service.invoke("ws-1", PAYMENT_REQUEST_TOOL.get, { requestRef: "1789000000001" }, caller("conn-payos"))).toEqual(STATE)
        expect(payosGet).toHaveBeenCalledWith(PAYOS, "1789000000001")
        const cancelled = await service.invoke("ws-1", PAYMENT_REQUEST_TOOL.cancel, { requestRef: "1789000000001", reason: "changed" }, caller("conn-payos"))
        expect(payosCancel).toHaveBeenCalledWith(PAYOS, "1789000000001", "changed")
        expect(cancelled).toMatchObject({ status: "cancelled", providerStatus: "CANCELLED", cancelledAt: "2026-11-13T10:05:00+07:00" })
    })

    it("answers get and cancel of a provider that keeps no request with the typed refusal no_request_state (business)", async () => {
        const { service } = await build()
        for (const tool of [PAYMENT_REQUEST_TOOL.get, PAYMENT_REQUEST_TOOL.cancel]) {
            expect(await paramsOf(service.invoke("ws-1", tool, { requestRef: "DH-20261113-0001" }, caller("conn-sepay")))).toEqual({
                reason: "no_request_state",
                refusalClass: "business",
            })
        }
    })

    it("refuses not_connected with no account handed or an account that is gone, and asks nothing", async () => {
        const { service, payosCreate, sepayCreate } = await build()
        for (const handed of [caller(), caller("conn-gone")]) {
            expect(await paramsOf(service.invoke("ws-1", PAYMENT_REQUEST_TOOL.create, ASK, handed))).toEqual({ reason: "not_connected", refusalClass: "infrastructure" })
        }
        expect(payosCreate).not.toHaveBeenCalled()
        expect(sepayCreate).not.toHaveBeenCalled()
    })

    it("answers a provider's refusal as the tool's own and throws any other failure with what it proves", async () => {
        const { service, payosCreate, payosCancel } = await build()
        payosCreate.mockRejectedValueOnce(providerRefusal("payos", "rejected", "order already exists"))
        expect(await paramsOf(service.invoke("ws-1", PAYMENT_REQUEST_TOOL.create, ASK, caller("conn-payos")))).toEqual({ reason: "rejected", refusalClass: "business" })
        payosCancel.mockRejectedValueOnce(providerRefusal("payos", "not_found"))
        expect(await paramsOf(service.invoke("ws-1", PAYMENT_REQUEST_TOOL.cancel, { requestRef: "1" }, caller("conn-payos")))).toEqual({ reason: "not_found", refusalClass: "business" })
        const lost = providerCallFailure("unknown")
        payosCreate.mockRejectedValueOnce(lost)
        await expect(service.invoke("ws-1", PAYMENT_REQUEST_TOOL.create, ASK, caller("conn-payos"))).rejects.toBe(lost)
    })

    it("refuses an argument outside its bounds before it asks any account, and an unknown tool as unknown", async () => {
        const { service, connections } = await build()
        await expect(service.invoke("ws-1", PAYMENT_REQUEST_TOOL.create, { amountVnd: 0, reference: "A" }, caller("conn-payos"))).rejects.toBeDefined()
        expect(connections.find).not.toHaveBeenCalled()
        await expect(service.invoke("ws-1", "payment.request.nothing", {}, caller("conn-payos"))).rejects.toBeDefined()
    })
})
