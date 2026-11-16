import type { PollPage } from "@modules/domain/connection-poll"
import { imapMailInputsOf, type DataRecordInput } from "@modules/domain/data-records"
import type { PollCadence, PolledRow } from "@modules/domain/provider-registry"

/** How often a mailbox's inbound half is read: the poll is its only way (no mail server calls NIVO), so dense; never beside a webhook. */
export const IMAP_POLL_CADENCE: PollCadence = { aloneMs: 5 * 60_000, besideWebhookMs: 5 * 60_000 }

/**
 * A page of mails as the poll receiver answers it: each mail as the `imap.mail` row the intake keeps (its key `<folder>:<uidvalidity>:<uid>`),
 * with the time the mail was sent; a mail the row cannot be made of is left out (counted in `fetched`, as before).
 */
export const imapPolledRowsOf = (page: PollPage<DataRecordInput>): PollPage<PolledRow> => {
    if (page.kind === "skipped") return page
    const items = page.items.flatMap((item) =>
        imapMailInputsOf([item]).map((input) => ({ value: input.value, at: timeOf(item.occurredAt) })),
    )
    return { kind: "page", items, fetched: page.fetched, oldestAt: page.oldestAt, newestAt: page.newestAt }
}

/** The instant of a mail, or null when the source does not say or says something that is no time. */
const timeOf = (at: string | Date | null | undefined): Date | null => {
    if (at === undefined || at === null) return null
    const date = at instanceof Date ? at : new Date(at)
    return Number.isNaN(date.getTime()) ? null : date
}
