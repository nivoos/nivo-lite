import { buildPublicApiChain, OWED_REPLY, sendJob, API_WS } from "@tests/fixtures/builders/public-api-chain.builder"
import { PublicApiErrorCode } from "./errors/public-api.error"

/** The process "dies" here: the error a call throws when its worker is gone before the call's outcome is known. */
const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

describe("public API chain: the send job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill after the channel took the message and before its row was settled: the second run does NOT send again (the claim is uncertain: a typed dead letter), the provider was asked once", async () => {
        const t = await buildPublicApiChain()
        jest.spyOn(t.ledger, "mark").mockRejectedValueOnce(killed())

        await expect(t.process(sendJob())).rejects.toMatchObject({ code: "ECONNRESET" })
        expect(t.channels.deliverToPerson).toHaveBeenCalledTimes(1)

        await expect(t.process(sendJob())).rejects.toMatchObject({ code: PublicApiErrorCode.SendOutcomeUnknown })

        expect(t.channels.deliverToPerson).toHaveBeenCalledTimes(1)
        expect(await t.ledger.byKey(API_WS, OWED_REPLY.sendKey)).toMatchObject({ state: "claimed" })
    })

    it("a person who checked with the customer resumes the parked send: it goes out once more, the row settles delivered, and a run after that sends nothing", async () => {
        const t = await buildPublicApiChain()
        jest.spyOn(t.ledger, "mark").mockRejectedValueOnce(killed())
        await expect(t.process(sendJob())).rejects.toMatchObject({ code: "ECONNRESET" })

        await t.process(sendJob({ resumeCount: 1 }))

        expect(t.channels.deliverToPerson).toHaveBeenCalledTimes(2)
        expect(await t.ledger.byKey(API_WS, OWED_REPLY.sendKey)).toMatchObject({ state: "delivered" })

        await t.process(sendJob({ resumeCount: 1 }))
        await t.process(sendJob())

        expect(t.channels.deliverToPerson).toHaveBeenCalledTimes(2)
    })

    it("a kill before the provider is asked (the claim was not made): the second run claims and sends once", async () => {
        const t = await buildPublicApiChain()
        jest.spyOn(t.ledger, "claim").mockRejectedValueOnce(killed())

        await expect(t.process(sendJob())).rejects.toMatchObject({ code: "ECONNRESET" })
        expect(t.channels.deliverToPerson).not.toHaveBeenCalled()

        await t.process(sendJob())

        expect(t.channels.deliverToPerson).toHaveBeenCalledTimes(1)
        expect(await t.ledger.byKey(API_WS, OWED_REPLY.sendKey)).toMatchObject({ state: "delivered" })
    })
})
