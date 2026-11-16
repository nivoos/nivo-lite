import { TOOL } from "@nivo-lite/agent-sdk/names"
import { Injectable } from "@nestjs/common"
import { ConnectionsService, type ConnectionRecord } from "@modules/domain/connections"
import {
    type ToolJson,
    type NativeToolFamily,
    type NativeCaller,
    type ToolManifest,
    argumentsOf,
    unknownTool,
} from "@modules/domain/tools"
import {
    PaymentRequestRegistryService,
    type PaymentRequest,
    type PaymentRequestPort,
    type PaymentRequestState,
} from "@modules/domain/provider-registry"
import {
    REQUEST_CANCEL_INPUT_SCHEMA,
    REQUEST_CANCEL_SCHEMA,
    REQUEST_CREATE_INPUT_SCHEMA,
    REQUEST_CREATE_SCHEMA,
    REQUEST_GET_INPUT_SCHEMA,
    REQUEST_GET_SCHEMA,
} from "./payment-request.schema"
import { paymentFailureOf, paymentRefusal } from "./payment-refusal.policy"
import { DomainError } from "@modules/platform/errors"

/** The tool names inside the connector (the full id is `nivo.tool.<name>`). */
export const PAYMENT_REQUEST_TOOL = {
    create: "payment.request.create",
    get: "payment.request.get",
    cancel: "payment.request.cancel",
} as const

/** The one payment-request purpose (owner ruling R111): named by what it does, never by the provider that does it. */
export const PAYMENT_REQUEST_MANIFEST: ToolManifest = {
    key: "payment-request",
    namespace: "nivo.tool",
    name: "Payment request",
    contractVersion: "payment-request-native@1",
    tools: [
        {
            name: PAYMENT_REQUEST_TOOL.create,
            description:
                "Asks the payer to pay an amount for your reference (an order code) through the chosen money account, and answers what the payer needs as the provider gave it: a pay page address (`payUrl`), a QR picture address (`qrImageUrl`) or a QR payload (`qrPayload`, text, never a picture), the bank details and the words to write (`transferContent`); plus `requestRef` when the provider keeps the request, and `payKey`: what the provider's paid event of this request carries as its `payKey`. It moves no money and settles nothing.",
            scope: "write",
            defaultMode: "ask",
            inputSchema: REQUEST_CREATE_INPUT_SCHEMA,
            argumentSchema: REQUEST_CREATE_SCHEMA,
            domain: TOOL.paymentRequestCreate,
            internalOnly: true,
        },
        {
            name: PAYMENT_REQUEST_TOOL.get,
            description:
                "One payment request of the chosen account by its `requestRef`: its status (`open`, `paid`, `cancelled`, `expired`), the provider's own status word, the amount and the amount paid when the provider says. Answers `not_found` for a request the account does not hold and `no_request_state` from a provider that keeps no request.",
            scope: "read",
            defaultMode: "auto",
            inputSchema: REQUEST_GET_INPUT_SCHEMA,
            argumentSchema: REQUEST_GET_SCHEMA,
            domain: TOOL.paymentRequestGet,
            internalOnly: true,
        },
        {
            name: PAYMENT_REQUEST_TOOL.cancel,
            description:
                "Cancels a payment request of the chosen account by its `requestRef`, with an optional reason, and answers its state. A request the provider cannot cancel is refused `rejected`; a provider that keeps no request answers `no_request_state`.",
            scope: "write",
            defaultMode: "ask",
            inputSchema: REQUEST_CANCEL_INPUT_SCHEMA,
            argumentSchema: REQUEST_CANCEL_SCHEMA,
            domain: TOOL.paymentRequestCancel,
            internalOnly: true,
        },
    ],
}

/** The answer of a create: only the members the provider gave. */
const requestedOf = (request: PaymentRequest): ToolJson => ({
    amountVnd: request.amountVnd,
    reference: request.reference,
    status: request.status,
    ...(request.payUrl === undefined ? {} : { payUrl: request.payUrl }),
    ...(request.qrImageUrl === undefined ? {} : { qrImageUrl: request.qrImageUrl }),
    ...(request.qrPayload === undefined ? {} : { qrPayload: request.qrPayload }),
    ...(request.transferContent === undefined ? {} : { transferContent: request.transferContent }),
    ...(request.bank === undefined
        ? {}
        : {
              bank: {
                  accountNumber: request.bank.accountNumber,
                  ...(request.bank.code === undefined ? {} : { code: request.bank.code }),
                  ...(request.bank.name === undefined ? {} : { name: request.bank.name }),
                  ...(request.bank.holder === undefined ? {} : { holder: request.bank.holder }),
              },
          }),
    ...(request.requestRef === undefined ? {} : { requestRef: request.requestRef }),
    payKey: request.payKey,
    ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
})

/** The answer of a get or a cancel: only the members the provider gave. */
const stateOf = (state: PaymentRequestState): ToolJson => ({
    requestRef: state.requestRef,
    amountVnd: state.amountVnd,
    ...(state.amountPaidVnd === undefined ? {} : { amountPaidVnd: state.amountPaidVnd }),
    status: state.status,
    providerStatus: state.providerStatus,
    ...(state.cancelledAt === undefined ? {} : { cancelledAt: state.cancelledAt }),
})

@Injectable()
/**
 * `nivo.tool.payment.request.create / get / cancel` (owner ruling R111): the payment request of the account the tool runner handed (never a
 * silent pick: no account handed is refused `not_connected`), made by the port its provider registered. Which provider serves is the
 * account's; this family names none. A port without `get` / `cancel` declares that its provider keeps no request: those calls answer the
 * typed refusal `no_request_state` (declared FINAL on the cancel). The tool runner keeps the answer under the call's key.
 */
export class PaymentRequestNativeService implements NativeToolFamily {
    readonly manifest: ToolManifest = PAYMENT_REQUEST_MANIFEST

    constructor(
        private readonly connections: ConnectionsService,
        private readonly requests: PaymentRequestRegistryService,
    ) {}

    /** Runs the tool. */
    async invoke(workspaceId: string, tool: string, args: ToolJson, caller: NativeCaller): Promise<ToolJson> {
        try {
            switch (tool) {
                case PAYMENT_REQUEST_TOOL.create:
                    return await this.create(workspaceId, args, caller)
                case PAYMENT_REQUEST_TOOL.get:
                    return await this.get(workspaceId, args, caller)
                case PAYMENT_REQUEST_TOOL.cancel:
                    return await this.cancel(workspaceId, args, caller)
                default:
                    throw unknownTool(tool)
            }
        } catch (cause) {
            const failure = paymentFailureOf(cause)
            if (failure instanceof DomainError) throw failure
            throw cause
        }
    }

    private async create(workspaceId: string, args: ToolJson, caller: NativeCaller): Promise<ToolJson> {
        const asked = argumentsOf(PAYMENT_REQUEST_TOOL.create, REQUEST_CREATE_SCHEMA, args)
        const { connection, port } = await this.portOf(workspaceId, caller)
        const request = await port.create(connection, {
            amountVnd: asked.amountVnd,
            reference: asked.reference,
            ...(asked.expiresAt === undefined ? {} : { expiresAt: asked.expiresAt }),
        })
        return requestedOf(request)
    }

    private async get(workspaceId: string, args: ToolJson, caller: NativeCaller): Promise<ToolJson> {
        const asked = argumentsOf(PAYMENT_REQUEST_TOOL.get, REQUEST_GET_SCHEMA, args)
        const { connection, port } = await this.portOf(workspaceId, caller)
        if (port.get === undefined) throw paymentRefusal("no_request_state")
        return stateOf(await port.get(connection, asked.requestRef))
    }

    private async cancel(workspaceId: string, args: ToolJson, caller: NativeCaller): Promise<ToolJson> {
        const asked = argumentsOf(PAYMENT_REQUEST_TOOL.cancel, REQUEST_CANCEL_SCHEMA, args)
        const { connection, port } = await this.portOf(workspaceId, caller)
        if (port.cancel === undefined) throw paymentRefusal("no_request_state")
        return stateOf(await port.cancel(connection, asked.requestRef, asked.reason))
    }

    /** The handed account and the port its provider registered; no account handed, none found or no port is `not_connected`. */
    private async portOf(workspaceId: string, caller: NativeCaller): Promise<{ readonly connection: ConnectionRecord; readonly port: PaymentRequestPort }> {
        if (caller.connectionId === undefined) throw paymentRefusal("not_connected")
        const connection = await this.connections.find(workspaceId, caller.connectionId)
        const port = connection === null ? undefined : this.requests.portFor(connection)
        if (connection === null || port === undefined) throw paymentRefusal("not_connected")
        return { connection, port }
    }
}
