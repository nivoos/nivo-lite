import { buildInboundRunner, pauseOf, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { telegramChain, TELEGRAM_DELIVERY } from "@tests/fixtures/builders/telegram-chain.builder"
import { channelAnswers } from "@tests/fixtures/builders/zalo-chain.builder"

describe("telegram chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("the shop's own file store staying down is retried on the waited ladder, then parks transient with ONE item and the update pending; the resume finishes", async () => {
        const h = await buildInboundRunner()
        const t = await telegramChain(h.claims)
        h.claim(TELEGRAM_DELIVERY)
        t.assets.upload.mockResolvedValue({ error: refused() })

        const pauses: Array<number | undefined> = []
        for (const attempt of [1, 2, 3, 4]) {
            const thrown = await h.run(t.processor, TELEGRAM_DELIVERY, attempt).catch((cause: unknown) => cause)
            pauses.push(pauseOf(thrown))
        }
        expect(pauses).toEqual([60, 120, 240, 480])
        expect(h.claims.park).not.toHaveBeenCalled()

        await h.run(t.processor, TELEGRAM_DELIVERY, 5)

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "telegram-delivery" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.state.wakes).toBe(0)
        expect(t.state.completed).toBe(false)

        // Telegram is back; a person resumes the job.
        const resumed = await buildInboundRunner(1)
        resumed.claim(TELEGRAM_DELIVERY)
        const again = await telegramChain(resumed.claims, t.ledger)
        await resumed.run(again.processor, TELEGRAM_DELIVERY, 1)

        expect(again.state.wakes).toBe(1)
        expect(again.state.completed).toBe(true)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("Telegram unreachable when the file is addressed is NOT a failure (R72 DEF-7): the message is delivered with the photo typed not kept, one run wakes", async () => {
        const h = await buildInboundRunner()
        const t = await telegramChain(h.claims)
        h.claim(TELEGRAM_DELIVERY)
        t.telegram.fileUrl.mockRejectedValue(refused())

        await h.run(t.processor, TELEGRAM_DELIVERY, 1)

        expect(h.claims.park).not.toHaveBeenCalled()
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.state.wakes).toBe(1)
        expect(t.triggers.deliver.mock.calls[0]?.[0].events[0]?.files).toEqual([
            expect.objectContaining({ url: "", notKept: "no_address" }),
        ])
    })

    it("a photo the channel refuses for good is NOT a failure: the message is delivered with a typed not-kept file entry that says why", async () => {
        const h = await buildInboundRunner()
        const t = await telegramChain(h.claims)
        h.claim(TELEGRAM_DELIVERY)
        t.remote.read.mockImplementation(channelAnswers(null, "image/jpeg", 404))

        await h.run(t.processor, TELEGRAM_DELIVERY, 1)

        expect(h.claims.park).not.toHaveBeenCalled()
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.triggers.deliver.mock.calls[0]?.[0].events[0]?.files).toEqual([
            expect.objectContaining({ id: "unread:refused_404:0", url: "", notKept: "refused_404" }),
        ])
    })
})
