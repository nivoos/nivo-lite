import { mock } from "@starci/jest-preset"
import { Test } from "@nestjs/testing"
import { ConnectionSecretsService } from "@modules/domain/connection-secrets"
import { ConnectionsErrorCode, ConnectionsService } from "@modules/domain/connections"
import { ZaloWizardDraftsService } from "@modules/domain/zalo-wizard-drafts"
import { ok, refused } from "@modules/platform/primitives"
import type { ZaloWizardPayload } from "@modules/queues/zalo-wizard"
import type { LoadedZalo } from "./channels.contracts"
import { ChannelsError, ChannelsErrorCode } from "./errors/channels.error"
import { ZaloCredentialsService } from "./zalo-credentials.service"
import { ZaloWizardService } from "./zalo-wizard.service"

const loaded = (oaSecret = "oa-secret"): LoadedZalo => ({
    secret: {
        appId: "app-1",
        appSecret: "app-secret",
        oaSecret,
        accessToken: "access-1",
        renewalToken: "refresh-1",
    },
    expiresAt: null,
    workspaceId: "ws-1",
})

const payload = (command: ZaloWizardPayload["command"]) => ({
    workspaceId: "ws-1",
    connectionId: "c-1",
    command,
    ticket: "ticket-1",
})

const build = async () => {
    const secrets = mock<ConnectionSecretsService>()
    secrets.seal.mockImplementation((plain) => `sealed:${plain}`)
    secrets.save.mockResolvedValue(undefined)
    const drafts = mock<ZaloWizardDraftsService>()
    drafts.draftOf.mockResolvedValue({
        present: true,
        appId: "app-1",
        appSecret: "app-secret",
        oaSecret: "oa-secret-2",
    })
    drafts.dropDraft.mockResolvedValue(undefined)
    const connections = mock<ConnectionsService>()
    connections.intakeOf.mockResolvedValue(ok({ id: "c-1", workspaceId: "ws-1", status: "pending" }))
    connections.settleWizard.mockResolvedValue(undefined)
    const credentials = mock<ZaloCredentialsService>()
    credentials.load.mockResolvedValue(ok(loaded()))
    credentials.beginAuthorization.mockResolvedValue({
        url: "https://oauth.test/permission",
        callbackUrl: "https://nivo.test/connections/zalo/callback",
    })
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

describe("ZaloWizardService", () => {
    it.each([undefined, null, [], "app", {}, { ...payload("app"), ticket: 1 }])(
        "refuses a payload that is not a wizard request as invalid, touching nothing: %p",
        async (input) => {
            const { service, secrets, drafts, connections, credentials } = await build()

            await expect(service.run(input)).rejects.toMatchObject({ code: ChannelsErrorCode.PayloadInvalid })

            expect(connections.intakeOf).not.toHaveBeenCalled()
            expect(connections.settleWizard).not.toHaveBeenCalled()
            expect(drafts.draftOf).not.toHaveBeenCalled()
            expect(secrets.save).not.toHaveBeenCalled()
            expect(credentials.load).not.toHaveBeenCalled()
            expect(credentials.beginAuthorization).not.toHaveBeenCalled()
        },
    )

    it("begins authorization and settles the permission URL under its ticket", async () => {
        const { service, credentials, connections, drafts, secrets } = await build()

        await service.run(payload("begin"))

        expect(credentials.beginAuthorization.mock.calls).toEqual([["ws-1", "c-1"]])
        expect(connections.settleWizard.mock.calls).toEqual([
            [
                "c-1",
                "ticket-1",
                {
                    command: "begin",
                    state: "done",
                    url: "https://oauth.test/permission",
                    code: "",
                    oaSecretSaved: false,
                },
            ],
        ])
        expect(connections.intakeOf.mock.calls).toEqual([["c-1", "zalo_oa"]])
        expect(drafts.draftOf).not.toHaveBeenCalled()
        expect(secrets.save).not.toHaveBeenCalled()
    })

    it("seals only the app keys from the draft, drops it, and settles the app command", async () => {
        const { service, secrets, drafts, connections, credentials } = await build()

        await service.run({ ...payload("app"), appId: "queue-app", appSecret: "queue-secret" })

        expect(connections.intakeOf.mock.calls).toEqual([["c-1", "zalo_oa"]])
        expect(drafts.draftOf.mock.calls).toEqual([["c-1"]])
        expect(secrets.seal.mock.calls).toEqual([['{"appId":"app-1","appSecret":"app-secret","oaSecret":""}']])
        expect(secrets.save.mock.calls).toEqual([
            ["c-1", 'sealed:{"appId":"app-1","appSecret":"app-secret","oaSecret":""}'],
        ])
        expect(drafts.dropDraft.mock.calls).toEqual([["c-1"]])
        expect(connections.settleWizard.mock.calls).toEqual([
            ["c-1", "ticket-1", { command: "app", state: "done", url: "", code: "", oaSecretSaved: false }],
        ])
        expect(credentials.load).not.toHaveBeenCalled()
    })
})

describe("ZaloWizardService", () => {
    it.each([
        { appId: "", appSecret: "app-secret" },
        { appId: "app-1", appSecret: "" },
    ])("fails an app draft with an empty app key: %p", async (keys) => {
        const { service, secrets, drafts, connections } = await build()
        drafts.draftOf.mockResolvedValue({ present: true, ...keys, oaSecret: "" })

        await service.run(payload("app"))

        expect(connections.settleWizard.mock.calls).toEqual([
            [
                "c-1",
                "ticket-1",
                { command: "app", state: "failed", url: "", code: "CHANNELS_SECRET_UNREADABLE", oaSecretSaved: false },
            ],
        ])
        expect(secrets.save).not.toHaveBeenCalled()
        expect(drafts.dropDraft).not.toHaveBeenCalled()
    })

    it("seals the OA key into the existing credential and settles that it was saved", async () => {
        const { service, secrets, drafts, connections, credentials } = await build()

        await service.run({ ...payload("oa"), oaSecret: "queue-secret" })

        expect(connections.intakeOf.mock.calls).toEqual([["c-1", "zalo_oa"]])
        expect(drafts.draftOf.mock.calls).toEqual([["c-1"]])
        expect(credentials.load.mock.calls).toEqual([["c-1"]])
        expect(secrets.seal.mock.calls).toEqual([
            [
                [
                    '{"appId":"app-1","appSecret":"app-secret",',
                    '"oaSecret":"oa-secret-2","accessToken":"access-1","renewalToken":"refresh-1"}',
                ].join(""),
            ],
        ])
        expect(secrets.save.mock.calls).toEqual([
            [
                "c-1",
                [
                    'sealed:{"appId":"app-1","appSecret":"app-secret",',
                    '"oaSecret":"oa-secret-2","accessToken":"access-1","renewalToken":"refresh-1"}',
                ].join(""),
            ],
        ])
        expect(drafts.dropDraft.mock.calls).toEqual([["c-1"]])
        expect(connections.settleWizard.mock.calls).toEqual([
            ["c-1", "ticket-1", { command: "oa", state: "done", url: "", code: "", oaSecretSaved: true }],
        ])
    })

    it("fails an OA command whose existing credential is unreadable", async () => {
        const { service, credentials, connections, secrets, drafts } = await build()
        credentials.load.mockResolvedValue(refused(ChannelsErrorCode.SecretUnreadable))

        await service.run(payload("oa"))

        expect(connections.settleWizard.mock.calls).toEqual([
            [
                "c-1",
                "ticket-1",
                { command: "oa", state: "failed", url: "", code: "CHANNELS_SECRET_UNREADABLE", oaSecretSaved: false },
            ],
        ])
        expect(secrets.save).not.toHaveBeenCalled()
        expect(drafts.dropDraft).not.toHaveBeenCalled()
    })
})

describe("ZaloWizardService", () => {
    it("settles a redelivered app command with a readable credential when the draft is gone", async () => {
        const { service, credentials, connections, secrets, drafts } = await build()
        drafts.draftOf.mockResolvedValue({ present: false, appId: "", appSecret: "", oaSecret: "" })

        await service.run(payload("app"))

        expect(credentials.load.mock.calls).toEqual([["c-1"]])
        expect(connections.settleWizard.mock.calls).toEqual([
            ["c-1", "ticket-1", { command: "app", state: "done", url: "", code: "", oaSecretSaved: false }],
        ])
        expect(secrets.save).not.toHaveBeenCalled()
        expect(drafts.dropDraft).not.toHaveBeenCalled()
    })

    it.each<ZaloWizardPayload["command"]>(["app", "oa"])(
        "fails a redelivered %s command with no draft and an unreadable credential",
        async (command) => {
            const { service, credentials, connections, secrets, drafts } = await build()
            drafts.draftOf.mockResolvedValue({ present: false, appId: "", appSecret: "", oaSecret: "" })
            credentials.load.mockResolvedValue(refused(ChannelsErrorCode.SecretUnreadable))

            await service.run(payload(command))

            expect(credentials.load.mock.calls).toEqual([["c-1"]])
            expect(connections.settleWizard.mock.calls).toEqual([
                [
                    "c-1",
                    "ticket-1",
                    { command, state: "failed", url: "", code: "CHANNELS_SECRET_UNREADABLE", oaSecretSaved: false },
                ],
            ])
            expect(secrets.save).not.toHaveBeenCalled()
            expect(drafts.dropDraft).not.toHaveBeenCalled()
        },
    )

    it.each([
        { oaSecret: "oa-secret", oaSecretSaved: true },
        { oaSecret: "", oaSecretSaved: false },
    ])("settles a redelivered OA command from the readable credential: %p", async ({ oaSecret, oaSecretSaved }) => {
        const { service, credentials, connections, secrets, drafts } = await build()
        drafts.draftOf.mockResolvedValue({ present: false, appId: "", appSecret: "", oaSecret: "" })
        credentials.load.mockResolvedValue(ok(loaded(oaSecret)))

        await service.run(payload("oa"))

        expect(credentials.load.mock.calls).toEqual([["c-1"]])
        expect(connections.settleWizard.mock.calls).toEqual([
            ["c-1", "ticket-1", { command: "oa", state: "done", url: "", code: "", oaSecretSaved }],
        ])
        expect(secrets.save).not.toHaveBeenCalled()
        expect(drafts.dropDraft).not.toHaveBeenCalled()
    })

    it("uses the readable credential for an OA draft with an empty key", async () => {
        const { service, credentials, connections, secrets, drafts } = await build()
        drafts.draftOf.mockResolvedValue({ present: true, appId: "", appSecret: "", oaSecret: "" })

        await service.run(payload("oa"))

        expect(credentials.load.mock.calls).toEqual([["c-1"]])
        expect(connections.settleWizard.mock.calls).toEqual([
            ["c-1", "ticket-1", { command: "oa", state: "done", url: "", code: "", oaSecretSaved: true }],
        ])
        expect(secrets.save).not.toHaveBeenCalled()
        expect(drafts.dropDraft).not.toHaveBeenCalled()
    })
})

describe("ZaloWizardService", () => {
    it.each<ZaloWizardPayload["command"]>(["app", "oa", "begin"])(
        "settles a missing connection for %s as failed and ends the job",
        async (command) => {
            const { service, connections, drafts, credentials } = await build()
            connections.intakeOf.mockResolvedValue(refused(ConnectionsErrorCode.NotFound))

            await service.run(payload(command))

            expect(connections.intakeOf.mock.calls).toEqual([["c-1", "zalo_oa"]])
            expect(connections.settleWizard.mock.calls).toEqual([
                [
                    "c-1",
                    "ticket-1",
                    { command, state: "failed", url: "", code: "CHANNELS_CONNECTION_NOT_FOUND", oaSecretSaved: false },
                ],
            ])
            expect(drafts.draftOf).not.toHaveBeenCalled()
            expect(credentials.beginAuthorization).not.toHaveBeenCalled()
        },
    )

    it("settles a connection belonging to another workspace as failed", async () => {
        const { service, connections, drafts } = await build()
        connections.intakeOf.mockResolvedValue(ok({ id: "c-1", workspaceId: "ws-2", status: "pending" }))

        await service.run(payload("app"))

        expect(connections.settleWizard.mock.calls).toEqual([
            [
                "c-1",
                "ticket-1",
                {
                    command: "app",
                    state: "failed",
                    url: "",
                    code: "CHANNELS_CONNECTION_NOT_FOUND",
                    oaSecretSaved: false,
                },
            ],
        ])
        expect(drafts.draftOf).not.toHaveBeenCalled()
    })
})

describe("ZaloWizardService", () => {
    it("throws a refused authorization for the runner and settles nothing: a failure is not an answer", async () => {
        const { service, credentials, connections } = await build()
        const cause = new ChannelsError({ code: ChannelsErrorCode.SecretUnreadable })
        credentials.beginAuthorization.mockRejectedValue(cause)

        await expect(service.run(payload("begin"))).rejects.toBe(cause)

        expect(connections.settleWizard).not.toHaveBeenCalled()
    })

    it("propagates a failure outside channels without settling or removing the draft", async () => {
        const { service, secrets, connections, drafts } = await build()
        const cause = { reason: "secret storage unavailable" }
        secrets.save.mockRejectedValue(cause)

        await expect(service.run(payload("app"))).rejects.toBe(cause)

        expect(connections.settleWizard).not.toHaveBeenCalled()
        expect(drafts.dropDraft).not.toHaveBeenCalled()
    })

    it("writes the stopped result under the ticket when the job reaches its dead letter, and refuses a payload that is not a wizard step", async () => {
        const { service, connections } = await build()

        await service.stopped(payload("begin"))

        expect(connections.settleWizard.mock.calls).toEqual([
            [
                "c-1",
                "ticket-1",
                { command: "begin", state: "failed", url: "", code: "CHANNELS_WIZARD_STOPPED", oaSecretSaved: false },
            ],
        ])
        await expect(service.stopped({ other: true })).rejects.toMatchObject({ code: ChannelsErrorCode.PayloadInvalid })
    })
})
