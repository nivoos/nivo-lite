import { Injectable } from "@nestjs/common"
import type { PollFailure, PollLimits, PollPage, PollWindow } from "@modules/domain/connection-poll"
import { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import type { ConnectionRecord } from "@modules/domain/connections"
import type { PollCadence, PolledRow, PollReceiver } from "@modules/domain/provider-registry"
import { InjectSepay, SepayError, SepayErrorCode, type SepayClient } from "@modules/integrations/sepay"
import { sepayPolledRow } from "./sepay-poll.policy"

/** How often SePay's transactions are read: every 5 minutes when no webhook delivers, every 30 beside a delivering one (the scheduler's own values). */
export const SEPAY_POLL_CADENCE: PollCadence = { aloneMs: 5 * 60_000, besideWebhookMs: 30 * 60_000 }

@Injectable()
/**
 * SePay's POLL RECEIVER (owner R95): reads the transactions of a SePay connection's bank account from the SePay user API, with the API token
 * that connection holds, as the `sepay.transaction` rows its webhook door keeps (same key, so a movement the webhook also brought is one
 * row). It reads the provider only: the engine's one poll job writes what it answers through the intake and admits the new rows.
 */
export class SepayTransactionReceiverService implements PollReceiver {
    readonly provider = "sepay"
    readonly dataType = "sepay.transaction"
    readonly cadence: PollCadence = SEPAY_POLL_CADENCE
    /**
     * Conservative until SePay publishes more: its user API is documented at about two calls per second per account, so one credential
     * gets that rate, no larger burst and one call at a time.
     */
    readonly limits: PollLimits = { ratePerSecond: 2, burst: 2, concurrency: 1 }

    constructor(
        @InjectSepay() private readonly sepay: SepayClient,
        private readonly tokens: ConnectionApiTokenService,
    ) {}

    /** Reads one page; a connection with no API token or no full account number is left out, not failed. */
    async read(account: ConnectionRecord, window: PollWindow): Promise<PollPage<PolledRow>> {
        const accountNumber = account.meta.account_number ?? ""
        if (accountNumber === "") return { kind: "skipped", reason: "no_account" }
        const token = await this.tokens.read(account.id)
        if (token === null) return { kind: "skipped", reason: "no_token" }
        const rows = await this.sepay.listTransactions(token, {
            accountNumber,
            from: window.from,
            to: window.to,
            limit: window.limit,
        })
        const times = rows.map((row) => row.occurredAt.getTime())
        return {
            kind: "page",
            items: rows.flatMap((row) => {
                const polled = sepayPolledRow(row, accountNumber)
                return polled === undefined ? [] : [polled]
            }),
            fetched: rows.length,
            oldestAt: rows.length === 0 ? undefined : new Date(Math.min(...times)),
            newestAt: rows.length === 0 ? undefined : new Date(Math.max(...times)),
        }
    }

    /** Classifies a SePay failure: asked to slow down, token refused, unreachable (retry later) or anything else (give up). */
    classify(error: unknown): PollFailure {
        if (!(error instanceof SepayError)) return { kind: "fatal" }
        if (error.code === SepayErrorCode.RateLimited) {
            const seconds: unknown = error.params.retryAfterSeconds
            return { kind: "rate_limited", retryAfterSeconds: typeof seconds === "number" ? seconds : 0 }
        }
        if (error.code === SepayErrorCode.AuthFailed) return { kind: "auth_failed" }
        return error.code === SepayErrorCode.Unavailable ? { kind: "transient" } : { kind: "fatal" }
    }
}
