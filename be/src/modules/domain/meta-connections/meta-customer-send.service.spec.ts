import { mock } from "@starci/jest-preset"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { ChannelsErrorCode, type CustomerSendPort } from "@modules/domain/channels"
import { MetaChannelSender } from "./meta-channel-sender.service"
import { MetaCustomerSendService } from "./meta-customer-send.service"

const ACCOUNT = connectionRecord({ id: "m1", workspaceId: "ws-1", provider: "meta" })
const TARGET = { id: "route-1", workspaceId: "ws-1", channel: "facebook", externalId: "person-1:archived", connectionId: "m1" }
const REQUEST = { workspaceId: "ws-1", conversationId: "route-1", messageId: "m-1", text: "Hello", at: new Date(0) }

describe("MetaCustomerSendService (the live Page sender behind the port)", () => {
    it("hands the target and the text to the Page sender unchanged and answers its yes as an acknowledged delivery", async () => {
        const sender = mock<MetaChannelSender>()
        sender.deliver.mockResolvedValue({ ok: true, ids: ["mid-1"] })
        const service = new MetaCustomerSendService(sender)

        expect(service.provider).toBe("meta")
        await expect(service.send(ACCOUNT, TARGET, "person-1", REQUEST)).resolves.toEqual({ delivered: true, failure: null, outcome: "acknowledged" })
        expect(sender.deliver).toHaveBeenCalledWith(TARGET, "Hello")
    })

    it("answers any other no (a Page gone, a refusal, the window, no answer) as an unknown outcome, as the engine always read it", async () => {
        const sender = mock<MetaChannelSender>()
        const service = new MetaCustomerSendService(sender)

        for (const answer of [null, { ok: false, reason: "window_expired" }, { ok: false, reason: "error", detail: "down" }] as const) {
            sender.deliver.mockResolvedValueOnce(answer)
            await expect(service.send(ACCOUNT, { ...TARGET, channel: "instagram" }, "person-1", REQUEST)).resolves.toEqual({
                delivered: false,
                failure: null,
                outcome: "ambiguous",
            })
        }
    })

    it("answers Meta's typed refusal FOR NOW (a rate limit, temporarily unavailable) with nothing taken as the port's not-sent answer; after a part went out it stays unknown", async () => {
        const sender = mock<MetaChannelSender>()
        const service = new MetaCustomerSendService(sender)

        for (const reason of ["rate_limited", "unavailable"] as const) {
            sender.deliver.mockResolvedValueOnce({ ok: false, reason })
            await expect(service.send(ACCOUNT, TARGET, "person-1", REQUEST)).rejects.toMatchObject({
                code: ChannelsErrorCode.SendUnavailable,
                params: { reason: `meta_${reason}` },
            })
        }
        sender.deliver.mockResolvedValueOnce({ ok: false, reason: "rate_limited", detail: "sent 1 of 2 parts", partsSent: 1 })
        await expect(service.send(ACCOUNT, TARGET, "person-1", REQUEST)).resolves.toMatchObject({ outcome: "ambiguous" })
    })

    it("has no staff text, no name read and no typing", () => {
        const service: CustomerSendPort = new MetaCustomerSendService(mock<MetaChannelSender>())

        expect([service.sendToPerson, service.nameOf, service.showTyping]).toEqual([undefined, undefined, undefined])
    })
})
