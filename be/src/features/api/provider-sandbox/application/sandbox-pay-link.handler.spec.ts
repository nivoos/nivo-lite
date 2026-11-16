import { mock } from "@starci/jest-preset"
import type { ProviderSandboxAccountsService, SandboxPayLinkView } from "@modules/domain/provider-sandbox"
import type { Logger } from "@modules/platform/logging"
import { SandboxPayLinkQuery } from "./provider-sandbox.queries"
import { SandboxPayLinkHandler } from "./sandbox-pay-link.handler"

describe("SandboxPayLinkHandler", () => {
    it("asks the doors for the link as the signed-in person in the request's workspace and hands the view back as it is", async () => {
        const accounts = mock<ProviderSandboxAccountsService>()
        const view: SandboxPayLinkView = {
            account: { id: "c-1", provider: "payos", label: "PayOS thử" },
            linkId: "sbx-payos-c-1-000001",
            amountVnd: 150000,
            content: "DH001",
            orderCode: "1780000000001",
            status: "open",
            amountReceivedVnd: 0,
            caseIds: ["PAYOS-3"],
            inputs: { orderCode: 1780000000001 },
        }
        accounts.payLink.mockResolvedValue(view)

        const found = await new SandboxPayLinkHandler(mock<Logger>(), accounts).execute(
            new SandboxPayLinkQuery({ request: { workspaceId: "ws-1", linkId: view.linkId }, principal: { id: "user-1", role: "authenticated" } }),
        )

        expect(accounts.payLink).toHaveBeenCalledWith({ principalId: "user-1", workspaceId: "ws-1" }, view.linkId)
        expect(found).toBe(view)
    })

    it("lets a refusal of the doors travel (unknown link, live account, sandbox off)", async () => {
        const accounts = mock<ProviderSandboxAccountsService>()
        accounts.payLink.mockRejectedValue(new Error("PROVIDER_SANDBOX_PAY_LINK_UNKNOWN"))

        await expect(
            new SandboxPayLinkHandler(mock<Logger>(), accounts).execute(
                new SandboxPayLinkQuery({ request: { workspaceId: "ws-1", linkId: "x" }, principal: { id: "user-1", role: "authenticated" } }),
            ),
        ).rejects.toThrow("PROVIDER_SANDBOX_PAY_LINK_UNKNOWN")
    })
})
