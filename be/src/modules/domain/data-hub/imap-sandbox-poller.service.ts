import { Injectable } from "@nestjs/common"
import type { PollFailure, PollLimits, PollPage, PollWindow } from "@modules/domain/connection-poll"
import type { ConnectionRecord } from "@modules/domain/connections"
import { IMAP_MAIL_TYPE, type DataRecordInput } from "@modules/domain/data-records"
import type { PollCadence, PolledRow, PollReceiver } from "@modules/domain/provider-registry"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { IMAP_INBOUND_PROVIDER, holdsInbound } from "./imap-inbound.policy"
import { IMAP_POLL_LIMITS } from "./imap-inbox-poller.service"
import { IMAP_POLL_CADENCE, imapPolledRowsOf } from "./imap-polled-rows.policy"
import {
    IMAP_PULL_OPERATION,
    IMAP_SANDBOX_DELIVERED_STATE,
    IMAP_SANDBOX_FOLDER,
    IMAP_SANDBOX_UID_STATE,
    imapRowsOf,
    imapSetIdOf,
} from "./imap-sandbox.catalogue"

@Injectable()
/**
 * The sandbox twin of the mailbox's poll face (`IMAP-1` .. `9`): a page of a sandbox mailbox (an `imap` account, or a mailbox `smtp`
 * account holding its inbound half) is the account's hardcoded mails, never an IMAP client and never a credential. The account's next
 * case picks the SET the page holds (default `IMAP-1`). Each set is handed ONCE per account: its mails take the next UIDs of the sandbox
 * INBOX (state `imap-uid`) and are dated at the moment of the poll (inside the window), so a second poll hands nothing and the next set
 * hands new mails; what the poll stores goes through the same intake as a live page. One logged call per page.
 */
export class ImapSandboxPollerService implements PollReceiver {
    readonly provider = IMAP_INBOUND_PROVIDER
    readonly limits: PollLimits = IMAP_POLL_LIMITS
    readonly dataType: string = IMAP_MAIL_TYPE
    readonly cadence: PollCadence = IMAP_POLL_CADENCE

    constructor(
        private readonly sandbox: ProviderSandboxService,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /** One page of the window as `imap.mail` rows (the poll receiver's answer). */
    async read(connection: ConnectionRecord, window: PollWindow): Promise<PollPage<PolledRow>> {
        return imapPolledRowsOf(await this.page(connection, window))
    }

    private async page(connection: ConnectionRecord, _window: PollWindow): Promise<PollPage<DataRecordInput>> {
        if (!holdsInbound(connection)) return { kind: "skipped", reason: "no_account" }
        const rows = await this.sandbox.call(connection, IMAP_PULL_OPERATION, { folders: [IMAP_SANDBOX_FOLDER] }, {
            key: IMAP_SANDBOX_FOLDER,
            answer: async (state): Promise<ReadonlyArray<DataRecordInput>> => {
                const setId = imapSetIdOf(state.nextCase)
                if ((await state.read(IMAP_SANDBOX_DELIVERED_STATE, setId)) !== null) return []
                const kept = await state.read(IMAP_SANDBOX_UID_STATE, IMAP_SANDBOX_FOLDER)
                const last = typeof kept === "number" ? kept : 0
                const handed = imapRowsOf(setId, last + 1, this.clock.now())
                await state.write(IMAP_SANDBOX_UID_STATE, IMAP_SANDBOX_FOLDER, last + handed.length)
                await state.write(IMAP_SANDBOX_DELIVERED_STATE, setId, true)
                return handed
            },
        })
        const newestFirst = rows.toReversed()
        const times = newestFirst.map((row) => (row.occurredAt === undefined || row.occurredAt === null ? undefined : new Date(row.occurredAt)))
        return { kind: "page", items: newestFirst, fetched: rows.length, oldestAt: times.at(-1), newestAt: times[0] }
    }

    /** The sandbox answers from its catalogue: a failure of it is the frame's own (off, not a sandbox account), never retried. */
    classify(_error: unknown): PollFailure {
        return { kind: "fatal" }
    }
}
