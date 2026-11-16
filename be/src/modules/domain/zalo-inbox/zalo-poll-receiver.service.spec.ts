import { mock } from "@starci/jest-preset"
import type { PollPage } from "@modules/domain/connection-poll"
import type { ConnectionRecord } from "@modules/domain/connections"
import { ZaloInboxPollerService } from "@modules/domain/zalo-provider"
import type { ZaloChatMessage } from "@modules/integrations/zalo"
import { ZaloPollReceiverService } from "./zalo-poll-receiver.service"
import { zaloEventRowsOf } from "./zalo.normalise.policy"

const connection = mock<ConnectionRecord>({ id: "c-1", workspaceId: "ws-1", provider: "zalo_oa", sandbox: false })
const window = { from: new Date("2026-11-01T00:00:00.000Z"), to: undefined, limit: 100 }

const chat: ZaloChatMessage = {
    messageId: "m-1",
    userId: "user-1",
    userName: "Lan",
    fromUser: true,
    kind: "text",
    text: "Hello",
    sentAt: 1_762_192_200_000,
}

/** The body Zalo's webhook posts for the same customer text. */
const webhookBody = (): Buffer =>
    Buffer.from(
        JSON.stringify({
            event_name: "user_send_text",
            timestamp: String(chat.sentAt),
            sender: { id: "user-1" },
            message: { msg_id: "m-1", text: "Hello" },
        }),
    )

const pageOf = (items: ReadonlyArray<ZaloChatMessage>): PollPage<ZaloChatMessage> => ({
    kind: "page",
    items,
    fetched: items.length,
    oldestAt: items.length === 0 ? undefined : new Date(chat.sentAt),
    newestAt: items.length === 0 ? undefined : new Date(chat.sentAt),
})

const build = () => {
    const reader = mock<ZaloInboxPollerService>({ limits: { ratePerSecond: 2, burst: 4, concurrency: 2 } })
    return { reader, receiver: new ZaloPollReceiverService(reader) }
}

describe("ZaloPollReceiverService", () => {
    it("answers a listed text as the zalo_oa.event row of the webhook's key, tagged as the poll, timed at Zalo's stamp", async () => {
        const { reader, receiver } = build()
        reader.fetch.mockResolvedValue(pageOf([chat]))

        const page = await receiver.read(connection, window)

        if (page.kind !== "page") throw new Error("page expected")
        const [webhookRow] = zaloEventRowsOf(webhookBody())
        const [polled] = page.items
        expect(polled?.value).toMatchObject({
            eventId: (webhookRow?.value as { eventId: string }).eventId,
            event: "user_send_text",
            source: "poll",
        })
        expect(polled?.at).toEqual(new Date(chat.sentAt))
        expect(page).toMatchObject({ fetched: 1 })
    })

    it("keeps the listing's name as the sender's display name, leaving the message members as the webhook has them", async () => {
        const { reader, receiver } = build()
        reader.fetch.mockResolvedValue(pageOf([chat]))

        const page = await receiver.read(connection, window)

        expect(page.kind === "page" ? page.items[0]?.value : null).toMatchObject({
            raw: {
                timestamp: String(chat.sentAt),
                sender: { id: "user-1", display_name: "Lan" },
                message: { msg_id: "m-1", text: "Hello" },
            },
        })
    })

    it("passes a skipped read through and reads the provider only (one dependency: no clock, no store)", async () => {
        const { reader, receiver } = build()
        reader.fetch.mockResolvedValue({ kind: "skipped", reason: "no_token" })

        expect(await receiver.read(connection, window)).toEqual({ kind: "skipped", reason: "no_token" })
        expect(ZaloPollReceiverService.length).toBe(1)
    })

    it("is the zalo_oa receiver of the zalo_oa.event type with the reader's limits, today's cadence and the reader's failure classes", () => {
        const { reader, receiver } = build()
        reader.classify.mockReturnValue({ kind: "transient" })

        expect([receiver.provider, receiver.dataType]).toEqual(["zalo_oa", "zalo_oa.event"])
        expect(receiver.limits).toEqual({ ratePerSecond: 2, burst: 4, concurrency: 2 })
        expect(receiver.cadence).toEqual({ aloneMs: 300_000, besideWebhookMs: 1_800_000 })
        expect(receiver.classify(new Error("x"))).toEqual({ kind: "transient" })
    })
})
