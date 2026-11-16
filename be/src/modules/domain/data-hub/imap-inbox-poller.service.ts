import { Injectable } from "@nestjs/common"
import type { PollFailure, PollLimits, PollPage, PollWindow } from "@modules/domain/connection-poll"
import { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import { ConnectionsService, type ConnectionRecord } from "@modules/domain/connections"
import { IMAP_MAIL_TYPE, type DataRecordInput } from "@modules/domain/data-records"
import type { PollCadence, PolledRow, PollReceiver } from "@modules/domain/provider-registry"
import { InjectImap, type ImapClient } from "@modules/integrations/data-sources"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { IMAP_INBOUND_PROVIDER, holdsInbound, inboundFromSecret, inboundIsReadCredential } from "./imap-inbound.policy"
import { parseConfig, parseCredential } from "./imap-connection.policy"
import { imapPollFailureOf } from "./imap-poll-failure.policy"
import { IMAP_POLL_CADENCE, imapPolledRowsOf } from "./imap-polled-rows.policy"

const DAY_MS = 86_400_000

/** What one IMAP login may be asked: one call at a time, one a second (a mail server counts logins, not requests). */
export const IMAP_POLL_LIMITS: PollLimits = { ratePerSecond: 1, burst: 1, concurrency: 1 }

@Injectable()
/**
 * THE MAILBOX'S POLL FACE (providers rule 12; MAIL-IN rule MI-1): one page of a mailbox's inbound half read over IMAP for the connection
 * poll, the ONE poll mechanism of an account's events (cursor, breaker, schedule are `connection-poll`'s). The inbound half is an `imap`
 * account standing alone (its credential is the account's own) or the inbound half of a mailbox `smtp` account (its credential is the
 * account's READ credential). A page is the newest mails of the window in the folders the owner chose, never older than the look-back the
 * owner chose; the poll stores each through the one intake, whose key makes a mail read twice nothing.
 */
export class ImapInboxPollerService implements PollReceiver {
    readonly provider = IMAP_INBOUND_PROVIDER
    readonly limits: PollLimits = IMAP_POLL_LIMITS
    readonly dataType: string = IMAP_MAIL_TYPE
    readonly cadence: PollCadence = IMAP_POLL_CADENCE

    constructor(
        @InjectImap() private readonly imap: ImapClient,
        @InjectClock() private readonly clock: Clock,
        private readonly connections: ConnectionsService,
        private readonly tokens: ConnectionApiTokenService,
    ) {}

    /** One page of the window as `imap.mail` rows (the poll receiver's answer). */
    async read(connection: ConnectionRecord, window: PollWindow): Promise<PollPage<PolledRow>> {
        return imapPolledRowsOf(await this.page(connection, window))
    }

    private async page(connection: ConnectionRecord, window: PollWindow): Promise<PollPage<DataRecordInput>> {
        if (!holdsInbound(connection)) return { kind: "skipped", reason: "no_account" }
        const raw = inboundIsReadCredential(connection)
            ? await this.tokens.read(connection.id)
            : inboundFromSecret(await this.connections.readSecret(connection.id))
        if (raw === null) return { kind: "skipped", reason: "no_token" }
        const config = parseConfig(connection.meta)
        const floor = this.clock.now().getTime() - config.sinceDays * DAY_MS
        const from = new Date(Math.max(window.from.getTime(), floor))
        const page = await this.imap.page(parseCredential(raw), { folders: config.folders, from, to: window.to, limit: window.limit })
        return { kind: "page", items: page.rows, fetched: page.fetched, oldestAt: page.oldestAt, newestAt: page.newestAt }
    }

    /** A refused login is the credential (only the owner fixes it); a server that does not answer is tried again; anything else ends. */
    classify(error: unknown): PollFailure {
        return imapPollFailureOf(error)
    }
}
