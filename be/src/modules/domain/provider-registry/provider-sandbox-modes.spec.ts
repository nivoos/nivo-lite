import { mock } from "@starci/jest-preset"
import { BANK_TRANSACTION_TRIGGERS } from "@modules/domain/bank-feed-inbox/bank-transaction.trigger"
import type { ConnectionsService } from "@modules/domain/connections"
import { PAYOS_SANDBOX_CATALOGUE } from "@modules/domain/payos-provider/payos-sandbox.catalogue"
import {
    ProviderSandboxAccountsService,
    ProviderSandboxErrorCode,
    SANDBOX_DELIVERY_MODES,
    SANDBOX_OUTCOMES,
    SandboxCatalogueRegistryService,
    type SandboxCatalogue,
} from "@modules/domain/provider-sandbox"
import { SEPAY_SANDBOX_CATALOGUE } from "@modules/domain/sepay-provider/sepay-sandbox.catalogue"
import { TELEGRAM_TRIGGERS } from "@modules/domain/telegram-inbox/telegram-message.trigger"
import { TELEGRAM_SANDBOX_CATALOGUE } from "@modules/domain/telegram-inbox/telegram-sandbox.catalogue"
import { TELEGRAM_SEND_SANDBOX_CATALOGUE } from "@modules/domain/telegram-inbox/telegram-sandbox-send.catalogue"
import { ZALO_MESSAGE_TRIGGER } from "@modules/domain/zalo-provider/zalo-message.trigger"
import { ZALO_SANDBOX_CATALOGUE } from "@modules/domain/zalo-provider/zalo-sandbox.catalogue"
import { ZALO_SEND_SANDBOX_CATALOGUE } from "@modules/domain/zalo-provider/zalo-sandbox-send.catalogue"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { RecordingWebhookPoster, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"

/*
 * THE GATE OF THE GENERIC MODES (SBX-CASES; provider-sandbox rule 18). Every provider that ships a sandbox among the first four (a message
 * provider with a poll, a message provider without one, a bank with a poll, a pay-link provider without one): every inbound case can be sent
 * in every delivery mode that applies to it, `withheld` only where the provider's own poll reads the case back (and `polled` equals the
 * trigger's `via` with a poll), and every outbound operation answers the generic outcomes through `setNextOutcome`.
 */

const NOW = new Date("2026-11-14T08:00:00.000Z")
const ACTOR = { principalId: "user-1", workspaceId: "ws-1" }

/** The providers and the catalogues each registers (the registry merges them by provider key, as the modules do). */
const PROVIDERS: ReadonlyArray<{ readonly provider: string; readonly catalogues: ReadonlyArray<SandboxCatalogue> }> = [
    { provider: "zalo_oa", catalogues: [ZALO_SANDBOX_CATALOGUE, ZALO_SEND_SANDBOX_CATALOGUE] },
    { provider: "telegram", catalogues: [TELEGRAM_SANDBOX_CATALOGUE, TELEGRAM_SEND_SANDBOX_CATALOGUE] },
    { provider: "sepay", catalogues: [SEPAY_SANDBOX_CATALOGUE] },
    { provider: "payos", catalogues: [PAYOS_SANDBOX_CATALOGUE] },
]

/** The trigger declarations whose `via` says whether the provider's poll returns the event, by provider and trigger name. */
const TRIGGER_VIA: ReadonlyMap<string, { readonly via: ReadonlyArray<string>; readonly withoutPoll: boolean }> = new Map(
    [ZALO_MESSAGE_TRIGGER, ...TELEGRAM_TRIGGERS, ...BANK_TRANSACTION_TRIGGERS].map((trigger) => [
        `${trigger.provider}/${trigger.name}`,
        { via: trigger.via, withoutPoll: trigger.withoutPoll !== undefined },
    ]),
)

/** The doors over one sandbox account of the provider, the real catalogues registered, a recording poster. */
const doorsOf = (provider: string, catalogues: ReadonlyArray<SandboxCatalogue>) => {
    const account = connectionRecord({ id: "11111111-1111-4111-8111-111111111111", provider, sandbox: true } as never)
    const connections = mock<ConnectionsService>()
    connections.authorize.mockResolvedValue({ role: "owner", displayName: "Lan" })
    connections.find.mockResolvedValue(account)
    connections.sandboxKeyOf.mockResolvedValue("sbx_key")
    const registry = new SandboxCatalogueRegistryService()
    for (const catalogue of catalogues) registry.register(catalogue)
    const poster = new RecordingWebhookPoster()
    const { sandbox } = sandboxServiceOf(account)
    const doors = new ProviderSandboxAccountsService(connections, sandbox, registry, poster, { now: () => NOW })
    return { account, doors, poster, registry }
}

describe("the generic delivery modes apply to every inbound case of every provider that ships a sandbox", () => {
    for (const { provider, catalogues } of PROVIDERS) {
        const inboundIds = catalogues.flatMap((one) => one.cases).filter((one) => one.inbound !== undefined).map((one) => one.id)

        it(`${provider}: ${String(inboundIds.length)} inbound cases, each sent once, twice and late; withheld only when polled`, async () => {
            expect(inboundIds.length).toBeGreaterThan(0)
            for (const id of inboundIds) {
                const once = doorsOf(provider, catalogues)
                const sentOnce = await once.doors.send(ACTOR, once.account.id, id, {}, { mode: "once" })
                const bodies = once.poster.posts.length

                const twice = doorsOf(provider, catalogues)
                await twice.doors.send(ACTOR, twice.account.id, id, {}, { mode: "twice" })
                expect([id, twice.poster.posts.length]).toEqual([id, bodies * 2])

                const late = doorsOf(provider, catalogues)
                const sentLate = await late.doors.send(ACTOR, late.account.id, id, {}, { mode: "late", lateBySeconds: 7_200 })
                expect([id, sentLate.mode, sentLate.lateBySeconds, late.poster.posts.length]).toEqual([id, "late", 7_200, bodies])

                const withheld = doorsOf(provider, catalogues)
                const polled = withheld.registry.caseOf(provider, id)?.inbound?.polled === true
                if (polled) {
                    const sent = await withheld.doors.send(ACTOR, withheld.account.id, id, {}, { mode: "withheld" })
                    expect([id, sent.webhookDropped, withheld.poster.posts.length]).toEqual([id, true, 0])
                } else {
                    await expect(withheld.doors.send(ACTOR, withheld.account.id, id, {}, { mode: "withheld" })).rejects.toMatchObject({
                        code: ProviderSandboxErrorCode.ModeUnavailable,
                    })
                }
                expect(sentOnce.mode).toBe("once")
            }
        })
    }

    it("`polled` equals the provider's trigger: a case is polled only where its trigger declares a poll and no withoutPoll", () => {
        const rows = PROVIDERS.flatMap(({ provider, catalogues }) =>
            catalogues.flatMap((one) => one.cases).flatMap((one) => (one.inbound === undefined ? [] : [{ provider, id: one.id, inbound: one.inbound }])),
        )
        const polled = rows.filter((row) => row.inbound.polled === true)
        expect(new Set(polled.map((row) => row.provider))).toEqual(new Set(["zalo_oa", "sepay"]))
        for (const row of polled) {
            const trigger = TRIGGER_VIA.get(`${row.provider}/${row.inbound.trigger}`)
            expect([row.id, trigger?.via.includes("poll"), trigger?.withoutPoll]).toEqual([row.id, true, false])
        }
        // A trigger that declares a poll and the case it feeds is `polled`, unless the poll cannot return its kind (Zalo's poll lists texts only).
        for (const row of rows.filter((each) => each.provider === "telegram" || each.provider === "payos")) {
            expect([row.id, row.inbound.polled]).toEqual([row.id, undefined])
        }
    })

    it("knows exactly the four delivery modes and the five outcomes the standard names", () => {
        expect(SANDBOX_DELIVERY_MODES).toEqual(["once", "twice", "withheld", "late"])
        expect(SANDBOX_OUTCOMES).toEqual(["ok", "refused", "final", "transient", "timeout"])
    })
})

describe("every outbound operation of those providers answers the generic outcomes", () => {
    /** The outcomes each operation may lack, each with why (the same reasons as the provider's coverage `na`). */
    const LACKS: Readonly<Record<string, ReadonlyArray<string>>> = {
        "sepay/transfer": ["transient", "timeout", "final"],
    }
    for (const { provider, catalogues } of PROVIDERS) {
        const outbound = catalogues.flatMap((one) => one.cases).filter((one) => one.operation !== undefined)
        const operations = [...new Set(outbound.map((one) => one.operation ?? ""))]
        for (const operation of operations) {
            it(`${provider}/${operation}: one default tagged ok, and setNextOutcome picks the case of each outcome it has`, async () => {
                const cases = outbound.filter((one) => one.operation === operation)
                expect(cases.filter((one) => one.default === true).map((one) => one.outcome)).toEqual(["ok"])
                expect(cases.every((one) => one.outcome !== undefined)).toBe(true)
                const { account, doors } = doorsOf(provider, catalogues)
                const lacking = LACKS[`${provider}/${operation}`] ?? []
                for (const outcome of SANDBOX_OUTCOMES.filter((one) => one !== "final")) {
                    const has = cases.some((one) => one.outcome === outcome)
                    expect([outcome, has || lacking.includes(outcome)]).toEqual([outcome, true])
                    if (has) {
                        const picked = await doors.setNextOutcome(ACTOR, account.id, operation, outcome)
                        expect(cases.find((one) => one.id === picked.caseId)?.outcome).toBe(outcome)
                    } else {
                        await expect(doors.setNextOutcome(ACTOR, account.id, operation, outcome)).rejects.toMatchObject({
                            code: ProviderSandboxErrorCode.OutcomeUnavailable,
                        })
                    }
                }
            })
        }
    }
})
