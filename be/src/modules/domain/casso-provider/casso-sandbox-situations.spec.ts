import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { BankFeedReceiptService } from "@modules/domain/bank-feed-inbox"
import { BankFeedReceiptsService, BillingErrorCode, type PaymentProofService } from "@modules/domain/billing"
import { cassoCredits, isCassoError } from "@modules/domain/billing/casso.policy"
import type { FeedWebhookRegistryService } from "@modules/domain/provider-registry"
import type { SandboxCase, SandboxInput } from "@modules/domain/provider-sandbox"
import { isSepayPing, readSepayPayload, type SepayBody } from "@modules/domain/sepay-provider/sepay-webhook.policy"
import { SEPAY_SANDBOX_CATALOGUE } from "@modules/domain/sepay-provider/sepay-sandbox.catalogue"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { CASSO_SANDBOX_CATALOGUE } from "./casso-sandbox.catalogue"
import { CASSO_SANDBOX_COVERAGE } from "./casso-sandbox.coverage"

/*
 * THE SANDBOX STANDARD for Casso (a bank feed: inbound + money): the situations the coverage names, read by Casso's REAL door intake
 * (`BankFeedReceiptsService.acceptCassoDelivery`, the service the Casso webhook controller hands every proven delivery to). The second kind
 * of each is the other bank feed, SePay: the not-a-line / no-id / malformed situations answered by SePay's own reading of its twin cases
 * (SEPAY-11, SEPAY-12), and the same money situations on both. Only the database behind the intake is a double.
 */

const CASSO = sandboxAccount({ id: "conn-c", workspaceId: "ws-1", provider: "casso" })
const SEPAY = sandboxAccount({ id: "conn-s", workspaceId: "ws-1", provider: "sepay" })
const AT = new Date("2026-11-14T02:15:02.000Z")
const ASKED: SandboxInput = { content: "NIVO DH1001", amount: 350_000 }

/** The bodies a case sends, built through the real frame as the one send builds them. */
const bodiesOf = async (catalogue: { readonly cases: ReadonlyArray<SandboxCase> }, account: typeof CASSO, id: string, input: SandboxInput = ASKED): Promise<ReadonlyArray<unknown>> => {
    const { sandbox } = sandboxServiceOf(account)
    const inbound = catalogue.cases.find((one) => one.id === id)?.inbound
    if (inbound === undefined) throw new Error(`no inbound case ${id}`)
    return (await sandbox.inbound(account, id, inbound, input, AT)).map((event) => event.body)
}

/** Casso's real intake over the bytes of a body: what it keeps (`keep` calls) and what it refuses. */
const intake = () => {
    const claims = mock<BankFeedReceiptService>()
    claims.keep.mockResolvedValue(1)
    const tx = fakeTransaction(mockEntityManager())
    const receipts = new BankFeedReceiptsService(tx.em, mock<PaymentProofService>(), claims, mock<FeedWebhookRegistryService>())
    return {
        claims,
        accept: async (body: unknown): Promise<void> => {
            await receipts.acceptCassoDelivery(Buffer.from(JSON.stringify(body)), "conn-c")
        },
        kept: () => claims.keep.mock.calls.flatMap(([, , , credits]) => credits),
    }
}

const failureOf = async (work: Promise<unknown>): Promise<unknown> => {
    try {
        await work
    } catch (cause) {
        return cause
    }
    throw new Error("expected a failure")
}

describe("Casso inbound situations read by the real door intake", () => {
    it("CASSO-8 (inbound.not_a_line): a delivery reporting an error is acknowledged and ignored, nothing is kept", async () => {
        const [body] = await bodiesOf(CASSO_SANDBOX_CATALOGUE, CASSO, "CASSO-8", {})
        expect(body).toEqual({ error: 1 })
        expect(isCassoError(body as Record<string, unknown>)).toBe(true)
        const door = intake()
        await door.accept(body)
        expect(door.kept()).toEqual([])
    })

    it("CASSO-9 (inbound.malformed): a body that is no JSON object is refused BILLING_WEBHOOK_INVALID, nothing is kept", async () => {
        const [body] = await bodiesOf(CASSO_SANDBOX_CATALOGUE, CASSO, "CASSO-9", {})
        expect(Array.isArray(body)).toBe(true)
        const door = intake()
        const refusal = await failureOf(door.accept(body))
        expect(refusal).toMatchObject({ code: BillingErrorCode.WebhookInvalid })
        expect(door.kept()).toEqual([])
    })

    it("CASSO-10 (inbound.not_a_line): money with no id and no reference is acknowledged and keeps nothing (the row has no key)", async () => {
        const [body] = await bodiesOf(CASSO_SANDBOX_CATALOGUE, CASSO, "CASSO-10")
        const data = (body as { data: Record<string, unknown> }).data
        expect(data).not.toHaveProperty("id")
        expect(data).not.toHaveProperty("reference")
        expect(data).toMatchObject({ amount: 350_000, description: "NIVO DH1001" })
        expect(cassoCredits(body as Record<string, unknown>)).toEqual([])
        const door = intake()
        await door.accept(body)
        expect(door.kept()).toEqual([])
    })

    it("CASSO-11 (shape v1Transactions): webhook V1's array row is read into the SAME credit as V2's object row (CASSO-1): event id, bank reference, account, time", async () => {
        const [v1] = await bodiesOf(CASSO_SANDBOX_CATALOGUE, CASSO, "CASSO-11")
        const [v2] = await bodiesOf(CASSO_SANDBOX_CATALOGUE, CASSO, "CASSO-1")
        expect(Array.isArray((v1 as { data: unknown }).data)).toBe(true)
        expect(Array.isArray((v2 as { data: unknown }).data)).toBe(false)
        const one = intake()
        await one.accept(v1)
        const two = intake()
        await two.accept(v2)
        expect(one.kept()).toHaveLength(1)
        expect(one.kept()).toEqual(two.kept())
        expect(one.kept()[0]).toMatchObject({ amount: 350_000, content: "NIVO DH1001", eventId: "casso:7100001", bankRef: "FT267100001", account: "0011004455667" })
    })

    it.each([
        ["CASSO-1", "exact", 350_000, "NIVO DH1001"],
        ["CASSO-2", "short", 349_000, "NIVO DH1001"],
        ["CASSO-3", "over", 351_000, "NIVO DH1001"],
        ["CASSO-4", "no reference", 350_000, ""],
        ["CASSO-7", "stranger reference", 350_000, "NIVO DH0000"],
    ])("%s (money.%s): the intake keeps the credit as the amount and content the case names", async (id, _kind, amount, content) => {
        const door = intake()
        for (const body of await bodiesOf(CASSO_SANDBOX_CATALOGUE, CASSO, id)) await door.accept(body)
        expect(door.kept()).toEqual([expect.objectContaining({ amount, content, eventId: "casso:7100001" })])
    })

    it("CASSO-5 (money.out): Casso's negative amount is no credit, the intake keeps nothing", async () => {
        const door = intake()
        for (const body of await bodiesOf(CASSO_SANDBOX_CATALOGUE, CASSO, "CASSO-5")) await door.accept(body)
        expect(door.kept()).toEqual([])
    })
})

describe("the second kind: the same situations at SePay's twin cases", () => {
    it("the same five money situations, SEPAY-1..4 and -7, build the same amounts and contents as CASSO-1..4 and -7", async () => {
        const pairs: ReadonlyArray<readonly [string, string]> = [
            ["CASSO-1", "SEPAY-1"],
            ["CASSO-2", "SEPAY-2"],
            ["CASSO-3", "SEPAY-3"],
            ["CASSO-4", "SEPAY-4"],
            ["CASSO-7", "SEPAY-7"],
        ]
        for (const [casso, sepay] of pairs) {
            const [cassoBody] = await bodiesOf(CASSO_SANDBOX_CATALOGUE, CASSO, casso)
            const [sepayBody] = await bodiesOf(SEPAY_SANDBOX_CATALOGUE, SEPAY, sepay)
            const credit = cassoCredits(cassoBody as Record<string, unknown>)[0]
            const reading = readSepayPayload(sepayBody as SepayBody)
            expect(reading?.transferAmount).toBe(credit?.amount)
            expect(reading?.content ?? "").toBe(credit?.content)
        }
    })

    it("not-a-line and no-id: SePay acknowledges its ping (SEPAY-11) and refuses a money delivery with no id (SEPAY-12); Casso acknowledges and keeps nothing for BOTH an error notice and a money row with no id (CASSO-8, CASSO-10)", async () => {
        const [ping] = await bodiesOf(SEPAY_SANDBOX_CATALOGUE, SEPAY, "SEPAY-11")
        const [noId] = await bodiesOf(SEPAY_SANDBOX_CATALOGUE, SEPAY, "SEPAY-12")
        expect(isSepayPing(ping as SepayBody)).toBe(true)
        expect(readSepayPayload(noId as SepayBody)).toBeUndefined()
        expect(isSepayPing(noId as SepayBody)).toBe(false)
        // The difference, said as it is: a Casso money row with no id is dropped by the door without a refusal (casso.policy.ts cassoCredits).
        const [cassoNoId] = await bodiesOf(CASSO_SANDBOX_CATALOGUE, CASSO, "CASSO-10")
        expect(cassoCredits(cassoNoId as Record<string, unknown>)).toEqual([])
    })
})

describe("the coverage names only cases that do what it says", () => {
    it("withheld is na (no poll), every money situation names a case, the shapes cover V1, V2 and the error notice", () => {
        const inbound = CASSO_SANDBOX_COVERAGE.roles.find((role) => role.role === "inbound")
        expect(inbound?.covers["inbound.withheld"]).toMatchObject({ na: expect.stringContaining("withoutPoll") })
        expect(Object.keys(inbound?.shapes ?? {})).toEqual(["v2Transaction", "v1Transactions", "errorNotice"])
        const money = CASSO_SANDBOX_COVERAGE.roles.find((role) => role.role === "money")
        expect(Object.values(money?.covers ?? {}).every((cover) => "cases" in cover)).toBe(true)
        expect(CASSO_SANDBOX_CATALOGUE.cases.some((one) => one.inbound?.polled === true)).toBe(false)
    })
})
