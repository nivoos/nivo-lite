import { mock } from "@starci/jest-preset"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import {
    ChannelDeliveryService,
    CustomerSendRegistryService,
    TelegramCustomerSendService,
    type CustomerSendPort,
} from "@modules/domain/channels"
import { ChannelPlanNoticeService } from "@modules/domain/channels/channel-plan-notice.service"
import { TelegramPicturesService } from "@modules/domain/channels/telegram-pictures.service"
import { ConnectionSecretReadsService, ConnectionsService } from "@modules/domain/connections"
import { TelegramClient } from "@modules/integrations/telegram/telegram.client"
import type { HttpClient, HttpResponse } from "@modules/platform/http"
import type { Logger } from "@modules/platform/logging"
import { ANSWER, FRONT, UNDERSTAND, WS, customerWrites, drain, processOf, stopsOf, threadDbOf, type ThreadDb } from "./thread-world"
import { chatServicesOf } from "./thread-world-intake"
import { seededDb } from "./thread-world-process"

// The world's desk installed beside the core (as send-outcome-unknown.spec.ts).
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const desk: typeof import("@tests/fixtures/builders/thread-desk-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/thread-desk-plugin.builder",
    )
    return { installed: parts.installationWith([desk.DESK_PLUGIN], "world-desk") }
})

// Rule QB-SEND (R75), on a SECOND channel: the customer send port has ONE channel-neutral "nothing was sent, try later"
// (`CHANNELS_SEND_UNAVAILABLE`), which every channel's live send maps its own busy answers onto. Here the LIVE Telegram send, behind the
// REAL delivery boundary and the REAL send executor, meets Telegram's typed too-many-requests (HTTP 429, `error_code` 429, `retry_after`):
// the key is settled refused, the step PARKS on the retry ladder (rule Q-2: the runner's one classifier reads it transient), no card;
// the timer runs the step again, the same key is claimed again and delivered ONCE. Only Telegram's HTTP answer is faked. The Zalo kind
// is covered by the Zalo port and sandbox specs (ZALO-SEND-5 / -6); the unknown-outcome road stays `send-outcome-unknown.spec.ts`.

/** The Telegram account the shop's front desk is attached to. */
const TELEGRAM = "telegram-1"

/** The person's chat id on Telegram. */
const CHAT = "700100200"

const REPLY = "Shop mo cua tu 8h den 21h a."

/** Telegram's own answers, in order: what the Bot API answers each `sendMessage`. */
const TOO_MANY: HttpResponse = {
    status: 429,
    body: { ok: false, error_code: 429, description: "Too Many Requests: retry after 30", parameters: { retry_after: 30 } },
}
const ACCEPTED: HttpResponse = { status: 200, body: { ok: true, result: { message_id: 1 } } }

/** The LIVE Telegram send behind the REAL delivery boundary, for the account `telegram-1`; only the HTTP answer is the world's. */
const liveTelegramOf = (db: ThreadDb, answers: Array<HttpResponse>) => {
    const http = mock<HttpClient>()
    http.request.mockImplementation(() => Promise.resolve(answers.shift() ?? ACCEPTED))
    const secrets = mock<ConnectionSecretReadsService>()
    secrets.botToken.mockResolvedValue({ kind: "ok", value: "123:token" })
    const logger = mock<Logger>()
    const live = new TelegramCustomerSendService(
        secrets,
        mock<TelegramPicturesService>(),
        new TelegramClient(http, { apiBase: "https://telegram.invalid", timeoutMs: 1_000 }),
        logger,
    )
    const registry = new CustomerSendRegistryService()
    registry.register({ live, sandbox: mock<CustomerSendPort>({ provider: "telegram" }) })
    const connections = mock<ConnectionsService>()
    connections.find.mockResolvedValue(connectionRecord({ id: TELEGRAM, workspaceId: WS, provider: "telegram" }))
    return { http, delivery: new ChannelDeliveryService(mock<ChannelPlanNoticeService>(), logger, db.clock, connections, registry) }
}

/** The person's park question, when the thread is parked. */
const parkOf = async (process: Awaited<ReturnType<typeof processOf>>, runId: string): Promise<Record<string, unknown> | null> => {
    const view = await process.threads.stateOf({ workspaceId: WS, runId })
    const question: unknown = view?.status === "stopped" ? view.stop?.question : null
    return typeof question === "object" && question !== null ? { ...question } : null
}

describe("rule QB-SEND: a send the channel did not take for now parks the step and is sent once later (second channel: Telegram)", () => {
    it("Telegram answers 429: parked on a retry (no stop, ledger refused, nothing said); the timer re-sends under the same key ONCE", async () => {
        const db = threadDbOf()
        db.rights.accounts.push({ id: TELEGRAM, provider: "telegram" })
        db.rights.attachments.push({ agentId: FRONT, connectionId: TELEGRAM, provider: "telegram" })
        const { http, delivery } = liveTelegramOf(db, [TOO_MANY])
        db.chat.channelDeliveries.set("telegram", delivery)
        await seededDb(db)
        const person = await chatServicesOf(db).contacts.meetChannel(WS, { channel: "telegram", account: TELEGRAM, userId: CHAT, name: "Lan" })
        const sends = { call: { tool: TOOL.customerMessageSend, args: { contactId: person, channel: "telegram", accountId: TELEGRAM, text: REPLY } } }
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } })
        // Each run of the answer step asks its agent turns afresh (the retry is a new visit). The not-sent answer stops the node (as an
        // unknown outcome does) and, rule SO-4 (SEND-ONE: a decided stop ends the turn), the model is asked NO further turn in that visit
        // (before SO-4 the loop spent three more scripted turns there for nothing): Telegram is asked once. The retry's visit sends and ends.
        db.model.script(ANSWER, sends, sends, { done: { reply: REPLY } })
        const process = await processOf(db)

        const runId = (await customerWrites(process, "Shop mo cua may gio?")).runId ?? ""

        expect(await stopsOf(process, runId)).toEqual([])
        const park = await parkOf(process, runId)
        expect(park).toMatchObject({ kind: "until_round", loopKey: "retry:answer", round: 1 })
        expect(db.lines).toEqual([])
        expect(db.chat.ledger.rows.map((row) => [row.text, row.state, row.reason])).toEqual([[REPLY, "refused", "telegram_rate_limited"]])
        expect(http.request).toHaveBeenCalledTimes(1)

        db.clock.advance(2 * 60_000)
        const from = db.wakes.length
        await expect(
            process.deadlines?.fire({ workspaceId: WS, runId, stepKey: String(park?.parkKey), repeats: 1, answered: -1 }),
        ).resolves.toBe("admitted")
        await drain(process, from)

        expect(await stopsOf(process, runId)).toEqual([])
        // ONE ledger row: the same send key, claimed again and delivered; Telegram asked twice, the person told once.
        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[REPLY, "delivered"]])
        expect(http.request).toHaveBeenCalledTimes(2)
        expect(db.lines.map((line) => line.text)).toEqual([REPLY])
    })
})
