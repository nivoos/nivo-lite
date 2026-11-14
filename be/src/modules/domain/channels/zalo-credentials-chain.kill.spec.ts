import { sha256 } from "@modules/domain/connections"
import { killed } from "@tests/fixtures/builders/provider-connections.builder"
import { buildZalo } from "@tests/fixtures/builders/zalo-credentials-chain.builder"
import { HOUR, NOW, secretOf, startedAuthorization, stored, tokens, zaloRefusal } from "@tests/fixtures/builders/zalo-credentials.builder"

const refreshJob = { workspaceId: "ws-1", connectionId: "c-1", expiresAt: NOW + 60_000 }
const KEY = `zalo.refresh:c-1:${sha256("refresh-1").slice(0, 16)}`
const SEALED_PAIR = `sealed:{"accessToken":"access-2","renewalToken":"refresh-2","expiresAt":${String(NOW + HOUR)}}`

describe("zalo refresh chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill after Zalo answered and before the pair was stored: the second run stores the KEPT pair and never spends the refresh token again", async () => {
        const t = await buildZalo()
        t.secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 60_000))
        t.zalo.refreshTokens.mockResolvedValue(tokens)
        t.secrets.save.mockRejectedValueOnce(killed())

        await expect(t.service.renewFromJob(refreshJob)).rejects.toMatchObject({ code: "ECONNRESET" })

        // Zalo answered once; the pair is on the ledger SEALED (never plain), and nothing was stored: the old token is burned.
        expect(t.zalo.refreshTokens).toHaveBeenCalledTimes(1)
        expect(t.ledger.rows.get(KEY)).toMatchObject({ state: "done", acts: 1, result: SEALED_PAIR })
        expect(JSON.stringify([...t.ledger.rows])).not.toContain('"access-2"')
        expect(t.secrets.save).toHaveBeenCalledTimes(1)

        await expect(t.service.renewFromJob(refreshJob)).resolves.toBeUndefined()

        expect(t.zalo.refreshTokens).toHaveBeenCalledTimes(1)
        expect(t.ledger.rows.get(KEY)?.acts).toBe(1)
        expect(t.secrets.save).toHaveBeenCalledTimes(2)
        expect(t.secrets.save.mock.calls[1]?.[1]).toContain('"renewalToken":"refresh-2"')
        expect(t.secrets.save.mock.calls[1]?.[2]).toEqual(new Date(NOW + HOUR))
    })

    it("a kill after Zalo answered and before the pair was kept is the one window left: the second run acts again under the same key, and a refused burned token reads failing", async () => {
        const t = await buildZalo()
        t.secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 60_000))
        t.zalo.refreshTokens.mockResolvedValueOnce(tokens)
        t.ledger.lostAfterAct(KEY)

        await expect(t.service.renewFromJob(refreshJob)).rejects.toMatchObject({ code: "ECONNRESET" })
        expect(t.secrets.save).not.toHaveBeenCalled()

        const refusal = zaloRefusal(-118)
        t.zalo.refreshTokens.mockRejectedValueOnce(refusal)
        await expect(t.service.renewFromJob(refreshJob)).rejects.toBe(refusal)

        expect(t.zalo.refreshTokens).toHaveBeenCalledTimes(2)
        // The refusal says the act did not happen: its intent is released and there is nothing to keep.
        expect(t.ledger.keys()).toEqual([])
        expect(t.connections.markFailing).toHaveBeenCalledWith("c-1", expect.stringContaining("Zalo OA"))
    })

    it("a kill while the tick writes its jobs: the same jobs are written again under the same keys, so each connection has one job", async () => {
        const t = await buildZalo()
        t.secretReads.dueZalo.mockResolvedValue([
            { id: "c-1", workspaceId: "ws-1", expiresAt: NOW + HOUR },
            { id: "c-2", workspaceId: "ws-1", expiresAt: NOW + 2 * HOUR },
        ])

        await t.service.fanOutDue(7 * HOUR)
        await t.service.fanOutDue(7 * HOUR)

        expect(t.written.map((job) => job.dedupeKey)).toEqual([
            `zalo_refresh.connection:c-1:${String(NOW + HOUR)}`,
            `zalo_refresh.connection:c-2:${String(NOW + 2 * HOUR)}`,
        ])
    })

    it("a job whose connection was renewed meanwhile (on use, or by the first run) ends without a call", async () => {
        const t = await buildZalo()
        t.secretReads.secretOf.mockResolvedValue(stored(secretOf({ renewalToken: "refresh-2" }), NOW + HOUR))

        await expect(t.service.renewFromJob(refreshJob)).resolves.toBeUndefined()

        expect(t.zalo.refreshTokens).not.toHaveBeenCalled()
        expect(t.ledger.keys()).toEqual([])
    })
})

describe("zalo authorization chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    const authorization = { workspaceId: "ws-1", state: "c-1.nonce-1", code: "code-1", oaId: "oa-9" }
    const EXCHANGE_KEY = `zalo.exchange:c-1:${sha256("code-1").slice(0, 16)}`

    it("a kill after the code was exchanged and before it was stored: the second run stores the kept pair even after the authorization's time, and exchanges nothing", async () => {
        const t = await buildZalo()
        t.secretReads.secretOf.mockResolvedValue(startedAuthorization())
        t.zalo.exchangeCode.mockResolvedValue(tokens)
        t.secrets.save.mockRejectedValueOnce(killed())

        await expect(t.service.completeFromJob(authorization)).rejects.toMatchObject({ code: "ECONNRESET" })

        expect(t.zalo.exchangeCode).toHaveBeenCalledTimes(1)
        expect(String(t.ledger.rows.get(EXCHANGE_KEY)?.result)).toMatch(/^sealed:/u)
        expect(t.connections.applyZaloAuthorization).not.toHaveBeenCalled()
        expect(t.bus.writes).toHaveLength(0)

        // The time the owner had is over when the job runs again: the kept answer is still stored, a NEW exchange would not be.
        t.clock.advance(20 * 60_000)
        await expect(t.service.completeFromJob(authorization)).resolves.toBeUndefined()

        expect(t.zalo.exchangeCode).toHaveBeenCalledTimes(1)
        expect(t.connections.applyZaloAuthorization).toHaveBeenCalledTimes(1)
        expect(t.bus.writes).toHaveLength(1)
        expect(t.connections.markFailing).not.toHaveBeenCalled()
    })

    it("a kill after everything committed and before the job was completed: the second run finds the tokens stored, marks nothing failing and announces nothing twice", async () => {
        const t = await buildZalo()
        t.secretReads.secretOf.mockResolvedValueOnce(startedAuthorization())
        t.zalo.exchangeCode.mockResolvedValue(tokens)
        await t.service.completeFromJob(authorization)
        expect(t.bus.writes).toHaveLength(1)

        // The stored credential now holds tokens and no started authorization.
        t.secretReads.secretOf.mockResolvedValue(stored(secretOf({ accessToken: "access-2", renewalToken: "refresh-2" })))
        await expect(t.service.completeFromJob(authorization)).resolves.toBeUndefined()

        expect(t.zalo.exchangeCode).toHaveBeenCalledTimes(1)
        expect(t.bus.writes).toHaveLength(1)
        expect(t.connections.markFailing).not.toHaveBeenCalled()
        expect(t.connections.applyZaloAuthorization).toHaveBeenCalledTimes(1)
    })

    it("keeps the typed ends typed: a return the owner cannot finish marks the connection and ends, with no exchange", async () => {
        const t = await buildZalo()
        t.secretReads.secretOf.mockResolvedValue(stored(secretOf({ accessToken: undefined, renewalToken: undefined })))

        await expect(t.service.completeFromJob(authorization)).resolves.toBeUndefined()

        expect(t.zalo.exchangeCode).not.toHaveBeenCalled()
        expect(t.connections.markFailing).toHaveBeenCalledTimes(1)
    })
})
