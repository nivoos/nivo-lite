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
import { imapPollFailureOf } from "./imap-poll-failure.policy"
import { imapLoginRefused, imapUnreachable } from "./imap-sandbox.failures"
import {
    IMAP_CASE,
    IMAP_PULL_OPERATION,
    IMAP_SANDBOX_DELIVERED_STATE,
    IMAP_SANDBOX_FOLDER,
    IMAP_SANDBOX_UID_STATE,
    imapRowsOf,
    imapSetIdOf,
    imapSetSizeOf,
} from "./imap-sandbox.catalogue"

/** Where a set was placed in the INBOX: its first UID and the moment of the poll that handed it (its dates derive from it). */
interface SetPlace {
    readonly firstUid: number
    readonly at: string
}

const placedOf = (kept: unknown): SetPlace | null => {
    if (typeof kept !== "object" || kept === null) return null
    const firstUid: unknown = Reflect.get(kept, "firstUid")
    const at: unknown = Reflect.get(kept, "at")
    return typeof firstUid === "number" && typeof at === "string" ? { firstUid, at } : null
}

/** What one poll read: the rows of the page (oldest first) and how many mails the window held in all (the live client's `fetched`). */
interface SandboxRead {
    readonly rows: ReadonlyArray<DataRecordInput>
    readonly fetched: number
}

/** The page the window and limit cut from a set (`ImapClient.page`: the mails received inside `[from, to]`, the newest `limit` of them). `windowed` false hands the whole set. */
const pageOf = (rows: ReadonlyArray<DataRecordInput>, window: PollWindow, windowed: boolean): SandboxRead => {
    if (!windowed) return { rows, fetched: rows.length }
    const inWindow = rows.filter((row) => {
        const at = row.occurredAt === undefined || row.occurredAt === null ? null : new Date(row.occurredAt).getTime()
        return at !== null && at >= window.from.getTime() && (window.to === undefined || at <= window.to.getTime())
    })
    return { rows: inWindow.slice(-window.limit), fetched: inWindow.length }
}

@Injectable()
/**
 * The sandbox twin of the mailbox's poll face (`IMAP-1` .. `16`): a page of a sandbox mailbox (an `imap` account, or a mailbox `smtp`
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

    private async page(connection: ConnectionRecord, window: PollWindow): Promise<PollPage<DataRecordInput>> {
        if (!holdsInbound(connection)) return { kind: "skipped", reason: "no_account" }
        const read = await this.sandbox.call(connection, IMAP_PULL_OPERATION, { folders: [IMAP_SANDBOX_FOLDER] }, {
            key: IMAP_SANDBOX_FOLDER,
            answer: async (state): Promise<SandboxRead> => {
                if (state.nextCase === IMAP_CASE.loginRefused) throw imapLoginRefused()
                if (state.nextCase === IMAP_CASE.unreachable) throw imapUnreachable()
                const setId = imapSetIdOf(state.nextCase)
                const placed = placedOf(await state.read(IMAP_SANDBOX_DELIVERED_STATE, setId))
                if (placed === null) {
                    const kept = await state.read(IMAP_SANDBOX_UID_STATE, IMAP_SANDBOX_FOLDER)
                    const last = typeof kept === "number" ? kept : 0
                    const size = imapSetSizeOf(setId)
                    const at = this.clock.now()
                    await state.write(IMAP_SANDBOX_UID_STATE, IMAP_SANDBOX_FOLDER, last + size)
                    await state.write(IMAP_SANDBOX_DELIVERED_STATE, setId, { firstUid: last + 1, at: at.toISOString() })
                    return pageOf(imapRowsOf(setId, last + 1, at), window, size > window.limit)
                }
                // A set that fits one page is handed ONCE; a set larger than a page stays readable, page after page, as a mailbox does: the
                // window (`from`, `to`) and the limit cut it as the live client cuts the INBOX (the newest `limit` of the window, newest first).
                if (imapSetSizeOf(setId) <= window.limit) return { rows: [], fetched: 0 }
                return pageOf(imapRowsOf(setId, placed.firstUid, new Date(placed.at)), window, true)
            },
        })
        const newestFirst = read.rows.toReversed()
        const times = newestFirst.map((row) => (row.occurredAt === undefined || row.occurredAt === null ? undefined : new Date(row.occurredAt)))
        return { kind: "page", items: newestFirst, fetched: read.fetched, oldestAt: times.at(-1), newestAt: times[0] }
    }

    /** The same reading as the live reader (`imapPollFailureOf`): the failing cases throw the live reader's own errors; the frame's own failures (off, not a sandbox account) are `fatal`, never retried. */
    classify(error: unknown): PollFailure {
        return imapPollFailureOf(error)
    }
}
