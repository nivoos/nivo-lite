import { sha256 } from "@modules/domain/connections"
import { REFRESH_ZALO_CONNECTION_JOB } from "@modules/queues/zalo-refresh"
import { buildZalo } from "@tests/fixtures/builders/zalo-credentials-chain.builder"
import { HOUR, NOW, missing, secretOf, stored, tokens } from "@tests/fixtures/builders/zalo-credentials.builder"
import { ChannelsErrorCode } from "./errors/channels.error"

describe("fanOutFromJob", () => {
    it("uses the payload horizon to select due credentials", async () => {
        const { service, secretReads } = await buildZalo()
        await expect(service.fanOutFromJob({ withinMs: 2 * HOUR })).resolves.toEqual({ queued: 0 })
        expect(secretReads.dueZalo.mock.calls).toEqual([[new Date("2026-10-12T12:00:00.000Z")]])
    })

    it.each([undefined, null, "tick", [], {}, { withinMs: "2" }])(
        "defaults to seven hours for a non-refresh payload: %p",
        async (payload) => {
            const { service, secretReads } = await buildZalo()

            await expect(service.fanOutFromJob(payload)).resolves.toEqual({ queued: 0 })
            expect(secretReads.dueZalo.mock.calls).toEqual([[new Date("2026-10-12T17:00:00.000Z")]])
        },
    )

    it("writes ONE renewal job per due connection, in one transaction, keyed by the connection and the token end that made it due", async () => {
        const { service, secretReads, written, inTransaction } = await buildZalo()
        secretReads.dueZalo.mockResolvedValue([
            { id: "c-1", workspaceId: "ws-1", expiresAt: NOW + HOUR },
            { id: "c-2", workspaceId: "ws-2", expiresAt: NOW + 2 * HOUR },
        ])

        await expect(service.fanOutDue(7 * HOUR)).resolves.toEqual({ queued: 2 })

        expect(written.map((job) => [job.queue, job.job, job.dedupeKey, job.payload])).toEqual([
            [
                "zalo_refresh",
                "zalo_refresh.connection",
                `zalo_refresh.connection:c-1:${String(NOW + HOUR)}`,
                { workspaceId: "ws-1", connectionId: "c-1", expiresAt: NOW + HOUR },
            ],
            [
                "zalo_refresh",
                "zalo_refresh.connection",
                `zalo_refresh.connection:c-2:${String(NOW + 2 * HOUR)}`,
                { workspaceId: "ws-2", connectionId: "c-2", expiresAt: NOW + 2 * HOUR },
            ],
        ])
        expect(inTransaction()).toBe(true)
    })

    it("writes the same job once when the next tick finds the same connection with the same token end (a parked one is not queued twice)", async () => {
        const { service, secretReads, written } = await buildZalo()
        secretReads.dueZalo.mockResolvedValue([{ id: "c-1", workspaceId: "ws-1", expiresAt: NOW + HOUR }])
        await service.fanOutDue(7 * HOUR)
        await service.fanOutDue(7 * HOUR)
        expect(written).toHaveLength(1)
        expect(
            REFRESH_ZALO_CONNECTION_JOB.onceKey({ workspaceId: "ws-1", connectionId: "c-1", expiresAt: NOW + HOUR }),
        ).toBe(written[0]?.dedupeKey)
    })
})

describe("renewFromJob", () => {
    const payload = { workspaceId: "ws-1", connectionId: "c-1", expiresAt: NOW + 60_000 }

    it("renews the connection whose token still ends when the job was written", async () => {
        const { service, zalo, secretReads } = await buildZalo()
        secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 60_000))
        zalo.refreshTokens.mockResolvedValue(tokens)
        await expect(service.renewFromJob(payload)).resolves.toBeUndefined()
        expect(zalo.refreshTokens.mock.calls).toEqual([["app-1", "app-secret", "refresh-1"]])
    })

    it("has nothing to renew when the token end moved (renewed on use), and spends no refresh token", async () => {
        const { service, zalo, secretReads } = await buildZalo()
        secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 3 * HOUR))
        await expect(service.renewFromJob(payload)).resolves.toBeUndefined()
        expect(zalo.refreshTokens).not.toHaveBeenCalled()
    })

    it("has nothing to renew for a connection that is gone", async () => {
        const { service, zalo, secretReads } = await buildZalo()
        secretReads.secretOf.mockResolvedValue(missing)
        await expect(service.renewFromJob(payload)).resolves.toBeUndefined()
        expect(zalo.refreshTokens).not.toHaveBeenCalled()
    })

    it("throws a credential it cannot read, and a payload that is not a renewal, for the runner", async () => {
        const { service, secretReads } = await buildZalo()
        secretReads.secretOf.mockResolvedValue(stored("not json"))
        await expect(service.renewFromJob(payload)).rejects.toMatchObject({ code: ChannelsErrorCode.SecretUnreadable })
        await expect(service.renewFromJob({ other: true })).rejects.toMatchObject({
            code: ChannelsErrorCode.PayloadInvalid,
        })
    })

    it("throws a busy lease for the runner's ladder instead of counting it", async () => {
        const { service, secrets, secretReads } = await buildZalo()
        secrets.takeLease.mockResolvedValue(false)
        secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 60_000))
        await expect(service.renewFromJob(payload)).rejects.toMatchObject({ code: ChannelsErrorCode.ZaloRefreshBusy })
    })
})

const SEALED =
    'sealed:{"appId":"app-1","appSecret":"app-secret","oaSecret":"oa-secret","accessToken":"access-2","renewalToken":"refresh-2","refreshExpiresAt":"2027-01-10T10:00:00.000Z"}'

describe("ZaloCredentialsService accessToken keeps the pair Zalo answered", () => {
    it("stores the pair once, from the answer the ledger kept sealed, and never keeps a token in plain text on the ledger", async () => {
        const { service, zalo, secrets, secretReads, ledger } = await buildZalo()
        secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 60_000))
        zalo.refreshTokens.mockResolvedValue(tokens)
        await expect(service.accessToken("c-1")).resolves.toBe("access-2")
        expect(secrets.save).toHaveBeenCalledTimes(1)
        expect(secrets.save.mock.calls).toEqual([["c-1", SEALED, new Date("2026-10-12T11:00:00.000Z")]])
        const [key, row] = [...ledger.rows.entries()][0] ?? []
        expect(key).toMatch(/^zalo\.refresh:c-1:[0-9a-f]{16}$/u)
        expect(JSON.stringify(row?.result)).toMatch(/^"sealed:/u)
        expect(key).not.toContain("refresh-1")
    })

    it("frees the lease and throws the failure when the save fails; the kept pair is stored by the next call without a second call to Zalo", async () => {
        const { service, zalo, secrets, secretReads } = await buildZalo()
        secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 60_000))
        zalo.refreshTokens.mockResolvedValue(tokens)
        const failure = new Error("database down")
        secrets.save.mockRejectedValueOnce(failure)
        await expect(service.accessToken("c-1")).rejects.toBe(failure)
        expect(secrets.releaseLease).toHaveBeenCalledWith("c-1")
        expect(secrets.save).toHaveBeenCalledTimes(1)

        await expect(service.accessToken("c-1")).resolves.toBe("access-2")

        expect(zalo.refreshTokens).toHaveBeenCalledTimes(1)
        expect(secrets.save).toHaveBeenCalledTimes(2)
        expect(secrets.save.mock.calls[1]).toEqual(["c-1", SEALED, new Date("2026-10-12T11:00:00.000Z")])
    })

    it("throws the failure of a lease that cannot be freed instead of swallowing it", async () => {
        const { service, zalo, secrets, secretReads } = await buildZalo()
        secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 60_000))
        zalo.refreshTokens.mockResolvedValue(tokens)
        const failure = new Error("database down")
        secrets.save.mockRejectedValue(new Error("save failed"))
        secrets.releaseLease.mockRejectedValue(failure)
        await expect(service.accessToken("c-1")).rejects.toBe(failure)
    })

    it("throws a kept value that is not a token pair (the ledger opened it) with a typed code", async () => {
        const { service, secretReads, ledger } = await buildZalo()
        secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 60_000))
        ledger.rows.set(`zalo.refresh:c-1:${sha256("refresh-1").slice(0, 16)}`, {
            state: "done",
            acts: 1,
            result: 'sealed:{"nope":1}',
        })
        await expect(service.accessToken("c-1")).rejects.toMatchObject({ code: ChannelsErrorCode.ZaloKeptPairUnreadable })
    })
})
