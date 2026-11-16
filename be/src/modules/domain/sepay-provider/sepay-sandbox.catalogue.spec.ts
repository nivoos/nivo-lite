import type { SandboxCase, SandboxInput } from "@modules/domain/provider-sandbox"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import {
    SEPAY_SANDBOX_CATALOGUE,
    SEPAY_SANDBOX_MOVEMENTS_STATE,
    sepayMovementsOf,
    sepayTimeOf,
    unknownReferenceOf,
} from "./sepay-sandbox.catalogue"
import { readSepayPayload } from "./sepay-webhook.policy"

const ACCOUNT = sandboxAccount({ id: "conn-s", workspaceId: "ws-1", provider: "sepay" })
const AT = new Date("2026-11-14T02:15:02.000Z")
const ASKED = { content: "NIVO DH1001", amount: 350_000 }

const inboundOf = (id: string): NonNullable<SandboxCase["inbound"]> => {
    const found = SEPAY_SANDBOX_CATALOGUE.cases.find((one) => one.id === id)?.inbound
    if (found === undefined) throw new Error(`no inbound case ${id}`)
    return found
}

/** Sends one case through the real frame (as the one send does) and answers its bodies. */
const send = async (sandbox: ReturnType<typeof sandboxServiceOf>["sandbox"], id: string, input: SandboxInput = ASKED) => {
    const events = await sandbox.inbound(ACCOUNT, id, inboundOf(id), input, AT)
    return events.map((event) => event.body as Record<string, unknown>)
}

describe("SEPAY_SANDBOX_CATALOGUE (owner ruling R62)", () => {
    it("holds SEPAY-1..7 inbound on SePay's real route, each taking { content, amount } and each polled; SEPAY-8..9 are the payment instruction", () => {
        expect(SEPAY_SANDBOX_CATALOGUE.provider).toBe("sepay")
        expect(SEPAY_SANDBOX_CATALOGUE.cases.map((one) => one.id)).toEqual([
            "SEPAY-1", "SEPAY-2", "SEPAY-3", "SEPAY-4", "SEPAY-5", "SEPAY-6", "SEPAY-7", "SEPAY-10", "SEPAY-11", "SEPAY-12", "SEPAY-8", "SEPAY-9",
        ])
        expect(SEPAY_SANDBOX_CATALOGUE.cases.filter((one) => one.operation === "transfer").map((one) => [one.id, one.outcome, one.default === true])).toEqual([
            ["SEPAY-8", "ok", true],
            ["SEPAY-9", "refused", false],
        ])
        for (const one of SEPAY_SANDBOX_CATALOGUE.cases.filter((each) => each.inbound !== undefined)) {
            expect(one.inbound?.polled === true).toBe(!["SEPAY-11", "SEPAY-12"].includes(one.id))
            expect(one.inbound?.path("conn-9")).toBe("api/connections/sepay/conn-9")
            expect(one.inbound?.inputs.map((field) => [field.name, field.kind])).toEqual([
                ["content", "text"],
                ["amount", "integer"],
            ])
            expect(one.label.toLowerCase()).not.toContain("order")
        }
    })

    it.each([
        ["SEPAY-1", "in", 350_000, "NIVO DH1001", 1],
        ["SEPAY-2", "in", 349_000, "NIVO DH1001", 1],
        ["SEPAY-3", "in", 351_000, "NIVO DH1001", 1],
        ["SEPAY-4", "in", 350_000, "", 1],
        ["SEPAY-5", "out", 350_000, "NIVO DH1001", 1],
        ["SEPAY-6", "in", 350_000, "NIVO DH1001", 1],
        ["SEPAY-7", "in", 350_000, "NIVO DH0000", 1],
    ])("%s transforms the inputs into SePay's webhook body (%s %d, content %j, posted %d time(s))", async (id, type, amount, content, posts) => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        const bodies = await send(sandbox, id)

        expect(bodies).toHaveLength(posts)
        expect(bodies[0]).toMatchObject({
            id: 9100001,
            transferType: type,
            transferAmount: amount,
            content,
            code: null,
            accountNumber: "0011004455667",
            gateway: "Vietcombank",
            transactionDate: "2026-11-14 09:15:02",
            referenceCode: "FT269100001",
        })
        expect(readSepayPayload(bodies[0] ?? {})).toMatchObject({ id: 9100001, transferType: type, transferAmount: amount })
        if (posts === 2) expect(bodies[1]).toEqual(bodies[0])
    })

    it("SEPAY-4 leaves the description empty too, so the content read is empty", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        const [body] = await send(sandbox, "SEPAY-4")
        expect(body).toMatchObject({ content: "", description: "" })
    })

    it("numbers the account's transactions, runs its balance, keeps each ONE movement for the poll (a double post is one movement)", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)

        await send(sandbox, "SEPAY-1")
        await send(sandbox, "SEPAY-6")
        await send(sandbox, "SEPAY-5", { content: "hoan tien", amount: 50_000 })

        const kept = sepayMovementsOf(await stateOf(sandbox))
        expect(kept.map((one) => [one.id, one.transferType, one.accumulated])).toEqual([
            [9100001, "in", 5_350_000],
            [9100002, "in", 5_700_000],
            [9100003, "out", 5_650_000],
        ])
    })

    it("SEPAY-10 reports the SAME bank reference under a NEW transaction id; SEPAY-11 is the ping (no id, no money, nothing kept); SEPAY-12 is money with no id (nothing kept)", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        const [first] = await send(sandbox, "SEPAY-1")
        const [again] = await send(sandbox, "SEPAY-10")
        expect(again).toMatchObject({ id: 9100002, referenceCode: (first as { referenceCode: string }).referenceCode, transferAmount: 350_000 })
        const [ping] = await send(sandbox, "SEPAY-11")
        const [noId] = await send(sandbox, "SEPAY-12")
        expect(ping).not.toHaveProperty("id")
        expect(ping).toMatchObject({ transferType: "in", transferAmount: 0 })
        expect(noId).not.toHaveProperty("id")
        expect(noId).toMatchObject({ transferType: "in", transferAmount: 350_000 })
        expect(sepayMovementsOf(await stateOf(sandbox)).map((one) => one.id)).toEqual([9100001, 9100002])
    })

    it("SEPAY-6 is SEPAY-1 under the generic `twice` delivery: one movement kept, no logic of its own", async () => {
        const one = SEPAY_SANDBOX_CATALOGUE.cases.find((each) => each.id === "SEPAY-1")?.inbound
        const six = SEPAY_SANDBOX_CATALOGUE.cases.find((each) => each.id === "SEPAY-6")?.inbound
        expect(six?.delivery).toEqual({ mode: "twice" })
        expect(one?.delivery).toBeUndefined()
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        await send(sandbox, "SEPAY-6")
        expect(sepayMovementsOf(await stateOf(sandbox))).toHaveLength(1)
    })

    it("prefills from the latest payment instruction (`transfer`): its content and amount", () => {
        expect(SEPAY_SANDBOX_CATALOGUE.prefill?.operation).toBe("transfer")
        expect(SEPAY_SANDBOX_CATALOGUE.prefill?.inputOf({ amountVnd: 350_000, content: "NIVO DH1001" })).toEqual(ASKED)
        expect(SEPAY_SANDBOX_CATALOGUE.prefill?.inputOf({ amountVnd: "x" })).toBeNull()
    })

    it("builds the unknown reference and SePay's Vietnam-time text deterministically", () => {
        expect(unknownReferenceOf("NIVO DH1001")).toBe("NIVO DH0000")
        expect(unknownReferenceOf("thanh toan")).toBe("thanh toan 000000")
        expect(sepayTimeOf(new Date("2026-11-14T20:00:00.000Z"))).toBe("2026-11-15 03:00:00")
    })
})

/** The movements kept in the account's state, read through one frame call (the state is only reachable inside a call). */
const stateOf = async (sandbox: ReturnType<typeof sandboxServiceOf>["sandbox"]): Promise<unknown> =>
    sandbox.call(ACCOUNT, "peek", {}, { answer: (state) => state.read(SEPAY_SANDBOX_MOVEMENTS_STATE, "") })
