import { buildInboundRunner, pauseOf, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { channelAnswers, zaloChain, ZALO_DELIVERY } from "@tests/fixtures/builders/zalo-chain.builder"

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

describe("zalo chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("the shop's own file store staying down is retried on the waited ladder (1, 2, 4, 8 min), then parks transient with ONE item and the event pending; the resume keeps the picture and finishes", async () => {
        const h = await buildInboundRunner()
        const t = await zaloChain(h.claims)
        h.claim(ZALO_DELIVERY)
        t.assets.upload.mockResolvedValue({ error: refused() })

        const pauses: Array<number | undefined> = []
        for (const attempt of [1, 2, 3, 4]) {
            const thrown = await h.run(t.processor, ZALO_DELIVERY, attempt).catch((cause: unknown) => cause)
            pauses.push(pauseOf(thrown))
        }
        expect(pauses).toEqual([60, 120, 240, 480])
        expect(h.claims.park).not.toHaveBeenCalled()
        expect(h.deadLetters.raise).not.toHaveBeenCalled()

        await h.run(t.processor, ZALO_DELIVERY, 5)

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "zalo-delivery" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        // No wake without the picture, and the event is still pending (nothing was committed).
        expect(t.state.wakes).toBe(0)
        expect(t.state.completed).toBe(false)
        expect(t.tx.commits).toBe(0)

        // The channel is back; a person resumes the job.
        t.remote.read.mockImplementation(channelAnswers(JPEG))
        const resumed = await buildInboundRunner(1)
        resumed.claim(ZALO_DELIVERY)
        const again = await zaloChain(resumed.claims, t.ledger)
        again.remote.read.mockImplementation(channelAnswers(JPEG))
        await resumed.run(again.processor, ZALO_DELIVERY, 1)

        expect(again.state.wakes).toBe(1)
        expect(again.state.completed).toBe(true)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("a channel that stays unreachable is NOT a failure (R72 DEF-7): the line is delivered with the picture typed fetch_failed, one run wakes, no job fails", async () => {
        const h = await buildInboundRunner()
        const t = await zaloChain(h.claims)
        h.claim(ZALO_DELIVERY)
        t.remote.read.mockRejectedValue(refused())

        await h.run(t.processor, ZALO_DELIVERY, 1)

        expect(h.claims.park).not.toHaveBeenCalled()
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.state.wakes).toBe(1)
        expect(t.state.completed).toBe(true)
        expect(t.triggers.deliver.mock.calls[0]?.[0].events[0]?.files).toEqual([
            expect.objectContaining({ id: "unread:fetch_failed:0", url: "", notKept: "fetch_failed" }),
        ])
    })

    it("a picture the channel refuses for good is NOT a failure: the message is delivered with a typed not-kept file entry that says why, and the job finishes", async () => {
        const h = await buildInboundRunner()
        const t = await zaloChain(h.claims)
        h.claim(ZALO_DELIVERY)
        t.remote.read.mockImplementation(channelAnswers(null, "image/jpeg", 404))

        await h.run(t.processor, ZALO_DELIVERY, 1)

        expect(h.claims.park).not.toHaveBeenCalled()
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.state.wakes).toBe(1)
        expect(t.triggers.deliver.mock.calls[0]?.[0].events[0]?.files).toEqual([
            expect.objectContaining({ id: "unread:refused_404:0", url: "", notKept: "refused_404" }),
        ])
    })

    it("a receipt that is no delivery reference parks at once as an input failure with ONE item (no retry is spent)", async () => {
        const h = await buildInboundRunner()
        const t = await zaloChain(h.claims)
        const broken = { deliveryId: "" }
        h.claim(broken)

        await h.run(t.processor, broken, 1)

        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "payload refused: zalo-delivery" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.remote.read).not.toHaveBeenCalled()
    })
})
