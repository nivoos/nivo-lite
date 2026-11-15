import { BankFeedReceiptService, type IncomingCredit } from "@modules/domain/bank-feed-inbox"
import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { FeedWebhookRegistryService, type FeedWebhookPort } from "@modules/domain/provider-registry"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import type { RawBody, HeaderValue, BankFeedProvider } from "./billing.contracts"
import { bankFactsOfCredit } from "./bank-facts.policy"
import { cassoCredits, isCassoError } from "./casso.policy"
import { BillingError, BillingErrorCode } from "./errors/billing.error"
import { PaymentProofService } from "./payment-proof.service"
import { payosBodyOf, readPayosDelivery } from "./payos.policy"
import { parseJsonObject } from "./webhook-body.policy"

@Injectable()
/**
 * The webhook doors' intake of the bank feed: a door proves each delivery, and this service keeps each movement of it once as the account's
 * `<provider>.transaction` row; a NEW row is admitted in the same transaction (`BankFeedAdmissionService`: its job runs `BankFeedService`,
 * which marks the account fed and hands the movement to its trigger). It decides nothing about a movement.
 */
export class BankFeedReceiptsService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        private readonly proof: PaymentProofService,
        private readonly bankFeedInbox: BankFeedReceiptService,
        private readonly webhooks: FeedWebhookRegistryService,
    ) {}

    /** Keeps each positive movement of Casso's verified delivery once (a new one is admitted in the same transaction). */
    acceptCassoDelivery(rawBody: RawBody, connection: string): Promise<void> {
        const raw = rawBody ?? Buffer.alloc(0)
        const body = parseJsonObject(raw)
        const credits = isCassoError(body)
            ? []
            : cassoCredits(body).map((credit) => ({
                  amount: credit.amount,
                  content: credit.content,
                  eventId: credit.eventId,
                  fallbackBankName: credit.bankName,
                  ...bankFactsOfCredit(credit),
              }))
        return this.keepMovements("casso", connection, credits)
    }

    /** Records a verified paid payOS delivery; confirmation pings and unpaid deliveries remain acknowledgements only. */
    acceptPayosDelivery(rawBody: RawBody, connection: string): Promise<void> {
        const reading = readPayosDelivery(payosBodyOf(parseJsonObject(rawBody)))
        if (reading.kind === "ignored") return Promise.resolve()
        return this.keepMovements("payos", connection, [
            {
                amount: reading.amount,
                content: reading.content,
                eventId: reading.eventId,
                fallbackBankName: "payOS",
                ...(reading.requestRef === undefined ? {} : { requestRef: reading.requestRef }),
                ...bankFactsOfCredit(reading),
            },
        ])
    }

    /**
     * Proves the workspace feed credential of a provider before its HTTP door admits the raw delivery to receipt intake. A refused key
     * is remembered by the provider for the connection page; any other failure is not the sender's doing.
     */
    async verifyFeedDelivery(
        authorization: HeaderValue,
        connection: string,
        rawBody: RawBody,
        provider: string,
    ): Promise<void> {
        try {
            await this.proof.proveFeed(provider, { authorization, connectionId: connection, rawBody })
        } catch (error) {
            if (error instanceof BillingError && error.code === BillingErrorCode.WebhookUnauthorized) {
                await this.webhooks.liveOf(provider)?.traceRefusal(connection)
            }
            throw error
        }
    }

    /**
     * Records one verified feed transaction of a provider as a receipt: money in as a credit, money out as a debit; anything its
     * provider reads as no money move (a test ping, a zero amount) is acknowledged without a receipt, and a delivery it cannot read is invalid.
     */
    acceptFeedDelivery(rawBody: RawBody, connection: string, provider: string): Promise<void> {
        const port = this.webhooks.liveOf(provider)
        if (port === undefined) return Promise.reject(new BillingError({ code: BillingErrorCode.WebhookInvalid }))
        return port.traceIntake(connection, rawBody, () => this.bookFeedDelivery(port, rawBody, connection))
    }

    private async bookFeedDelivery(port: FeedWebhookPort, rawBody: RawBody, connection: string): Promise<void> {
        const reading = port.read(parseJsonObject(rawBody))
        if (reading.kind === "invalid") throw new BillingError({ code: BillingErrorCode.WebhookInvalid })
        if (reading.kind === "ignored") return
        await this.keepMovements(port.inboxProvider, connection, [reading.credit])
    }

    /** Keeps the movements once and admits the new ones in one transaction; a repeat, an empty delivery or an unknown connection keeps nothing. */
    private async keepMovements(
        provider: BankFeedProvider,
        connection: string,
        credits: ReadonlyArray<IncomingCredit>,
    ): Promise<void> {
        if (credits.length === 0) return
        await this.entityManager.transaction((manager) => this.bankFeedInbox.keep(manager, provider, connection, credits, "webhook"))
    }
}
