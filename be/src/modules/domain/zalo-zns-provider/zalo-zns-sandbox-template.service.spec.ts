import { readFileSync } from "node:fs"
import { ProviderRegistryErrorCode, proofOf } from "@modules/domain/provider-registry"
import { ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import { ZALO_ZNS_SANDBOX_CASES, ZALO_ZNS_SANDBOX_CATALOGUE, ZALO_ZNS_SANDBOX_PROVIDER, ZNS_CASE, ZNS_SEND_OPERATION, ZNS_SENT_STATE } from "./zalo-zns-sandbox.catalogue"
import { ZaloZnsSandboxTemplateService } from "./zalo-zns-sandbox-template.service"

const ACCOUNT = sandboxAccount({ id: "conn-z", workspaceId: "ws-1", provider: "zalo_oa" })
const CONNECTION = connectionRecord({ id: "conn-z", workspaceId: "ws-1", provider: "zalo_oa", sandbox: true })
const request = (templateId: string) => ({ phone: "0900000001", templateId, data: { order: "NIVO-DH1001" }, trackingId: null })

const setup = () => {
    const { sandbox } = sandboxServiceOf(ACCOUNT)
    return { sandbox, service: new ZaloZnsSandboxTemplateService(sandbox) }
}
const picked = (ctx: ReturnType<typeof setup>, caseId: string) => ctx.sandbox.setNextCase(ACCOUNT, ZNS_SEND_OPERATION, caseId)

/** What a rejected promise threw. */
const thrownOf = (run: Promise<unknown>): Promise<unknown> => run.catch((cause: unknown) => cause)

describe("ZaloZnsSandboxTemplateService", () => {
    it("ZNS-1 (default): sends any template and names a running message id", async () => {
        const { service } = setup()

        expect(await service.sendTemplate(CONNECTION, request("000001"))).toEqual({ messageId: "SBX-ZNS-000001" })
        expect(await service.sendTemplate(CONNECTION, request("777777"))).toEqual({ messageId: "SBX-ZNS-000002" })
    })

    it("picks nothing from the template id: the old magic ids 000404 and 000429 are ordinary templates now", async () => {
        const { service } = setup()

        await expect(service.sendTemplate(CONNECTION, request("000404"))).resolves.toEqual({ messageId: "SBX-ZNS-000001" })
        await expect(service.sendTemplate(CONNECTION, request("000429"))).resolves.toEqual({ messageId: "SBX-ZNS-000002" })
    })

    it.each([
        [ZNS_CASE.templateNotFound, ProviderRegistryErrorCode.RefusedNotFound, "template not found"],
        [ZNS_CASE.quotaUsedUp, ProviderRegistryErrorCode.RefusedRejected, "template quota exceeded"],
        [ZNS_CASE.authRefused, ProviderRegistryErrorCode.RefusedAuth, "access token"],
    ] as const)("%s (sticky): refuses with the registry's typed refusal %s (%s), proved not_sent, sending nothing, until the default is picked again", async (caseId, code, detail) => {
        const ctx = setup()
        await picked(ctx, caseId)

        for (const templateId of ["000001", "000002"]) {
            const failure = await thrownOf(ctx.service.sendTemplate(CONNECTION, request(templateId)))
            expect(failure).toMatchObject({ code, params: { provider: "zalo_oa", detail } })
            expect(proofOf(failure)).toBe("not_sent")
        }
        await picked(ctx, ZNS_CASE.sent)
        await expect(ctx.service.sendTemplate(CONNECTION, request("000001"))).resolves.toEqual({ messageId: "SBX-ZNS-000003" })
    })

    it("ZNS-4 (not now): the registry's not-sent failure: nothing sent, the proof the tool runner retries on", async () => {
        const ctx = setup()
        await picked(ctx, ZNS_CASE.notNow)

        const failure = await thrownOf(ctx.service.sendTemplate(CONNECTION, request("000001")))

        expect(failure).toMatchObject({ code: ProviderRegistryErrorCode.CallNotSent })
        expect(proofOf(failure)).toBe("not_sent")
    })

    it("ZNS-5 (no answer): the registry's unknown failure, nothing sent", async () => {
        const ctx = setup()
        await picked(ctx, ZNS_CASE.timeout)

        const failure = await thrownOf(ctx.service.sendTemplate(CONNECTION, request("000001")))

        expect(failure).toMatchObject({ code: ProviderRegistryErrorCode.CallUnknown })
        expect(proofOf(failure)).toBe("unknown")
        await expect(ctx.sandbox.kept(ACCOUNT, ZNS_SENT_STATE, "SBX-ZNS-000001")).resolves.toBeNull()
    })

    it("ZNS-6 (no answer, but sent): the same unknown failure, the message IS in the account's sent messages, and a second send sends again", async () => {
        const ctx = setup()
        await picked(ctx, ZNS_CASE.appliedNoAnswer)

        const failure = await thrownOf(ctx.service.sendTemplate(CONNECTION, request("000001")))

        expect(failure).toMatchObject({ code: ProviderRegistryErrorCode.CallUnknown })
        await expect(ctx.sandbox.kept(ACCOUNT, ZNS_SENT_STATE, "SBX-ZNS-000001")).resolves.toEqual({ phone: "0900000001", templateId: "000001" })
        await picked(ctx, ZNS_CASE.sent)
        await expect(ctx.service.sendTemplate(CONNECTION, request("000001"))).resolves.toEqual({ messageId: "SBX-ZNS-000002" })
    })

    it("logs exactly one call per request, the failing ones as threw, under sendTemplate", async () => {
        const ctx = setup()

        await ctx.service.sendTemplate(CONNECTION, request("000001"))
        await picked(ctx, ZNS_CASE.quotaUsedUp)
        await thrownOf(ctx.service.sendTemplate(CONNECTION, request("000429")))

        const calls = await ctx.sandbox.calls(ACCOUNT, ZNS_SEND_OPERATION)
        expect(calls).toHaveLength(2)
        expect(calls[0]).toMatchObject({ key: "000001", result: { outcome: "answered" } })
        expect(calls[1]).toMatchObject({ key: "000429", result: { outcome: "threw" } })
    })

    it("refuses a live account and a switched-off sandbox", async () => {
        const { service } = setup()
        const off = new ZaloZnsSandboxTemplateService(sandboxServiceOff(ACCOUNT).sandbox)

        await expect(service.sendTemplate({ ...CONNECTION, sandbox: false }, request("000001"))).rejects.toMatchObject({
            code: ProviderSandboxErrorCode.LiveAccount,
        })
        await expect(off.sendTemplate(CONNECTION, request("000001"))).rejects.toMatchObject({ code: ProviderSandboxErrorCode.Off })
    })

    it("registers under the OA's own key zalo_oa (a ZNS send reaches an account of that kind), with unique ZNS-<n> ids, ONE default tagged ok, every case tagged, no inbound case, and zero network", () => {
        const ids = ZALO_ZNS_SANDBOX_CATALOGUE.cases.map((one) => one.id)
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")

        expect(ZALO_ZNS_SANDBOX_PROVIDER).toBe("zalo_oa")
        expect(ZALO_ZNS_SANDBOX_CATALOGUE.provider).toBe("zalo_oa")
        expect(ids).toEqual(Object.values(ZNS_CASE))
        expect(ZALO_ZNS_SANDBOX_CASES.every((one) => one.inbound === undefined && one.operation === ZNS_SEND_OPERATION && one.outcome !== undefined)).toBe(true)
        expect(ZALO_ZNS_SANDBOX_CASES.filter((one) => one.default === true).map((one) => [one.id, one.outcome])).toEqual([["ZNS-1", "ok"]])
        expect(ZaloZnsSandboxTemplateService.length).toBe(1)
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toContain("http")
    })
})
