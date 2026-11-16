import type { PollPage } from "@modules/domain/connection-poll"
import type { PolledRow, PollCadence } from "@modules/domain/provider-registry"
import type { ZaloChatMessage } from "@modules/integrations/zalo"
import { polledRawBody } from "./zalo-polled-body.policy"
import { zaloEventRowsOf } from "./zalo.normalise.policy"

/**
 * How often the OA's inbox is read: today's scheduler values. Zalo publishes no rate and no re-delivery for the OA, so the poll keeps its
 * dense 5 minutes while the webhook is silent and its sparse 30 minutes while the webhook delivers.
 */
export const ZALO_POLL_CADENCE: PollCadence = { aloneMs: 5 * 60_000, besideWebhookMs: 30 * 60_000 }

/**
 * The `zalo_oa.event` row one listed customer text becomes: the value the webhook door keeps for that message (its key is the message id, so
 * a message the webhook already delivered is the same row), with the door named `poll`, and the time Zalo stamped it.
 */
export const polledRowOf = (message: ZaloChatMessage): PolledRow => {
    const [row] = zaloEventRowsOf(polledRawBody(message), "poll")
    if (row === undefined) throw new Error("zaloEventRowsOf answers one row for one body")
    return { value: row.value, at: new Date(message.sentAt) }
}

/** A page of listed customer texts as a page of event rows; a skipped read stays skipped. */
export const polledPageOf = (page: PollPage<ZaloChatMessage>): PollPage<PolledRow> =>
    page.kind === "skipped" ? page : { ...page, items: page.items.map(polledRowOf) }
