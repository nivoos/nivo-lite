import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { ConnectionSecretsService } from "@modules/domain/connection-secrets"
import { ConnectionsService } from "@modules/domain/connections"
import { ZaloWizardDraftsService } from "@modules/domain/zalo-wizard-drafts"
import { ok } from "@modules/platform/primitives"
import { killed } from "@tests/fixtures/builders/provider-connections.builder"
import { ZaloCredentialsService } from "./zalo-credentials.service"
import { ZaloWizardService } from "./zalo-wizard.service"

const wizard = { workspaceId: "ws-1", connectionId: "c-1", command: "app" as const, ticket: "ticket-1" }
const SEALED = 'sealed:{"appId":"app-1","appSecret":"app-secret","oaSecret":""}'

const build = async () => {
    const secrets = mock<ConnectionSecretsService>()
    secrets.seal.mockImplementation((plain) => `sealed:${plain}`)
    secrets.save.mockResolvedValue(undefined)
    const drafts = mock<ZaloWizardDraftsService>()
    drafts.draftOf.mockResolvedValue({ present: true, appId: "app-1", appSecret: "app-secret", oaSecret: "" })
    drafts.dropDraft.mockResolvedValue(undefined)
    const connections = mock<ConnectionsService>()
    connections.intakeOf.mockResolvedValue(ok({ id: "c-1", workspaceId: "ws-1", status: "pending" }))
    connections.settleWizard.mockResolvedValue(undefined)
    const credentials = mock<ZaloCredentialsService>()
    credentials.load.mockResolvedValue(ok({ secret: { appId: "app-1", appSecret: "app-secret", oaSecret: "" }, expiresAt: null, workspaceId: "ws-1" }))
    const moduleRef = await Test.createTestingModule({
        providers: [
            ZaloWizardService,
            { provide: ConnectionSecretsService, useValue: secrets },
            { provide: ZaloWizardDraftsService, useValue: drafts },
            { provide: ConnectionsService, useValue: connections },
            { provide: ZaloCredentialsService, useValue: credentials },
        ],
    }).compile()
    return { service: moduleRef.get(ZaloWizardService), secrets, drafts, connections, credentials }
}

describe("zalo wizard chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill after the keys were sealed and before the draft was dropped: the second run seals the same text and settles the ticket once", async () => {
        const t = await build()
        t.drafts.dropDraft.mockRejectedValueOnce(killed())

        await expect(t.service.run(wizard)).rejects.toMatchObject({ code: "ECONNRESET" })
        expect(t.connections.settleWizard).not.toHaveBeenCalled()

        await expect(t.service.run(wizard)).resolves.toBeUndefined()

        expect(t.secrets.save.mock.calls).toEqual([
            ["c-1", SEALED],
            ["c-1", SEALED],
        ])
        expect(t.connections.settleWizard.mock.calls).toEqual([
            ["c-1", "ticket-1", { command: "app", state: "done", url: "", code: "", oaSecretSaved: false }],
        ])
    })

    it("a kill after the draft was dropped and before the ticket was settled: the second run finds the keys sealed and settles done, sealing nothing again", async () => {
        const t = await build()
        t.connections.settleWizard.mockRejectedValueOnce(killed())

        await expect(t.service.run(wizard)).rejects.toMatchObject({ code: "ECONNRESET" })
        t.drafts.draftOf.mockResolvedValue({ present: false, appId: "", appSecret: "", oaSecret: "" })

        await expect(t.service.run(wizard)).resolves.toBeUndefined()

        expect(t.secrets.save).toHaveBeenCalledTimes(1)
        expect(t.connections.settleWizard).toHaveBeenCalledTimes(2)
        expect(t.connections.settleWizard.mock.calls[1]).toEqual([
            "c-1",
            "ticket-1",
            { command: "app", state: "done", url: "", code: "", oaSecretSaved: false },
        ])
    })

    it("the permission URL step run twice asks for the page twice and writes the one ticket: the credentials service answers the same page while its verifier is live", async () => {
        const t = await build()
        t.credentials.beginAuthorization.mockResolvedValue({ url: "https://oauth.test/p", callbackUrl: "https://nivo.test/cb" })

        await t.service.run({ ...wizard, command: "begin" })
        await t.service.run({ ...wizard, command: "begin" })

        expect(t.credentials.beginAuthorization.mock.calls).toEqual([
            ["ws-1", "c-1"],
            ["ws-1", "c-1"],
        ])
        const results = t.connections.settleWizard.mock.calls.map((call) => call[2])
        expect(results[0]).toEqual(results[1])
    })
})
