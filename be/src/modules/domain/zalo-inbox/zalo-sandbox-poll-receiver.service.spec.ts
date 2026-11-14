import type { SandboxInput } from "@modules/domain/provider-sandbox"
import { ZALO_SANDBOX_CATALOGUE, ZaloSandboxInboxPollerService } from "@modules/domain/zalo-provider"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { ZaloSandboxPollReceiverService } from "./zalo-sandbox-poll-receiver.service"
import { zaloEventRowsOf } from "./zalo.normalise.policy"

const ACCOUNT = sandboxAccount({ id: "conn-z", workspaceId: "ws-1", provider: "zalo_oa" })
const CONNECTION = connectionRecord({ id: "conn-z", workspaceId: "ws-1", provider: "zalo_oa", sandbox: true })
const ALL = { from: new Date("2026-11-01T00:00:00.000Z"), to: undefined, limit: 100 }
const AT = new Date("2026-11-14T02:00:00.000Z")

const setup = () => {
    const { sandbox } = sandboxServiceOf(ACCOUNT)
    return { sandbox, receiver: new ZaloSandboxPollReceiverService(new ZaloSandboxInboxPollerService(sandbox)) }
}

/** Sends one inbound case through the real frame and answers the webhook bodies it made. */
const sendCase = async (sandbox: ReturnType<typeof setup>["sandbox"], id: string, input: SandboxInput, at: Date = AT) => {
    const inbound = ZALO_SANDBOX_CATALOGUE.cases.find((one) => one.id === id)?.inbound
    if (inbound === undefined) throw new Error(`no inbound case ${id}`)
    const events = await sandbox.inbound(ACCOUNT, id, inbound, input, at)
    return events.map((event) => event.body as Record<string, unknown>)
}

/** The key the webhook door keeps a body under. */
const keyOf = (body: Record<string, unknown>): string =>
    (zaloEventRowsOf(Buffer.from(JSON.stringify(body)))[0]?.value as { eventId: string }).eventId

describe("ZaloSandboxPollReceiverService", () => {
    it("answers a dropped webhook back: the rows its kept lines make carry the keys of the webhook bodies the cases sent", async () => {
        const { sandbox, receiver } = setup()
        const first = await sendCase(sandbox, "ZALO-1", { userId: "8800110022", text: "Chao shop" })
        const third = await sendCase(sandbox, "ZALO-3", { userId: "8800110044", text: "Don hom kia?" }, new Date("2026-11-14T03:00:00.000Z"))

        const page = await receiver.read(CONNECTION, ALL)

        if (page.kind !== "page") throw new Error("page expected")
        expect(page.items.map((row) => (row.value as { eventId: string }).eventId).toSorted()).toEqual([...first, ...third].map(keyOf).toSorted())
        expect(page.items.every((row) => (row.value as { source: string }).source === "poll")).toBe(true)
    })

    it("answers only texts as rows (a photo is counted fetched, not kept), each at the time its case stamped it", async () => {
        const { sandbox, receiver } = setup()
        await sendCase(sandbox, "ZALO-1", { userId: "8800110022", text: "Chao shop" })
        await sendCase(sandbox, "ZALO-2", { userId: "8800110033" }, new Date("2026-11-14T02:30:00.000Z"))

        const page = await receiver.read(CONNECTION, ALL)

        expect(page).toMatchObject({ kind: "page", fetched: 2 })
        expect(page.kind === "page" ? page.items.map((row) => row.at?.toISOString()) : []).toEqual([AT.toISOString()])
    })

    it("answers an account whose cases were never sent an empty page, and is the zalo_oa receiver of the same type as the live one", async () => {
        const { receiver } = setup()

        expect(await receiver.read(CONNECTION, ALL)).toMatchObject({ kind: "page", fetched: 0, items: [] })
        expect([receiver.provider, receiver.dataType, receiver.classify()]).toEqual(["zalo_oa", "zalo_oa.event", { kind: "fatal" }])
        expect(receiver.cadence).toEqual({ aloneMs: 300_000, besideWebhookMs: 1_800_000 })
    })
})
