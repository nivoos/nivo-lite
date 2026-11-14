import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { AccountDataAdmissionsService, AccountDataIntakeService } from "@modules/domain/account-data"
import { ConnectionBindingsReadService, ConnectionsService } from "@modules/domain/connections"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { isRecord } from "@modules/platform/primitives"
import {
    FAKE_COMPOSE,
    FAKE_OUTPUT,
    FAKE_SIGNED,
    FakeComposePort,
    composeAccountOf,
} from "@tests/fixtures/builders/video-compose.builder"
import type { RenderDoorDelivery } from "./video-compose.contracts"
import { VideoComposeRegistryService } from "./video-compose-registry.service"
import { VideoRenderAdmissionService } from "./video-render-admission.service"
import { VideoRenderIntakeService } from "./video-render-intake.service"

const ACCOUNT = composeAccountOf()
const OWNER = { id: ACCOUNT.id, workspaceId: "ws-1", provider: FAKE_COMPOSE }
const body = (hook: Readonly<Record<string, unknown>>): Buffer => Buffer.from(JSON.stringify(hook))
const DONE = body({ id: "r-1", state: "succeeded", url: FAKE_OUTPUT })

/** A delivery the door proved by its token, to the fake provider, with no headers unless given. */
const delivery = (
    rawBody: Buffer | undefined,
    headers: RenderDoorDelivery["headers"] = {},
    provider: string = FAKE_COMPOSE,
): RenderDoorDelivery => ({ provider, connectionId: ACCOUNT.id, rawBody, headers })

/** An intake whose store keeps the render ids it inserted: an `append` row is new once. */
const build = async (
    options: { readonly account?: typeof OWNER | null; readonly port?: FakeComposePort } = {},
) => {
    const manager = mockEntityManager()
    fakeTransaction(manager)
    const bindings = mock<ConnectionBindingsReadService>()
    bindings.accountOf.mockResolvedValue(options.account === undefined ? OWNER : options.account)
    const kept = new Set<string>()
    const intake = mock<AccountDataIntakeService>()
    intake.claim.mockImplementation((_tx, delivery) => {
        const key = String(isRecord(delivery.value) ? delivery.value["renderId"] : undefined)
        if (kept.has(key)) return Promise.resolve(undefined)
        kept.add(key)
        return Promise.resolve({ type: delivery.type, key, id: `row-${key}`, isNew: true })
    })
    const outbox = recordingQueueOutbox()
    const write = jest.spyOn(outbox, "write")
    const connections = mock<ConnectionsService>()
    connections.readSecret.mockResolvedValue({ plain: "cred", webhookSecret: "hook" })
    const moduleRef = await Test.createTestingModule({
        providers: [
            VideoRenderIntakeService,
            VideoRenderAdmissionService,
            AccountDataAdmissionsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: manager },
            { provide: LOGGER, useValue: mock<Logger>() },
            VideoComposeRegistryService,
            { provide: ConnectionBindingsReadService, useValue: bindings },
            { provide: ConnectionsService, useValue: connections },
            { provide: AccountDataIntakeService, useValue: intake },
            { provide: QUEUE_OUTBOX, useValue: outbox },
        ],
    }).compile()
    moduleRef.get(VideoComposeRegistryService).register(options.port ?? new FakeComposePort())
    moduleRef.get(VideoRenderAdmissionService).register()
    const service = moduleRef.get(VideoRenderIntakeService)
    return { service, intake, outbox, write }
}

describe("the render door's intake", () => {
    it("keeps a finished render once and writes the delivery job in the SAME transaction: the request delivers nothing itself", async () => {
        const { service, intake, outbox, write } = await build()
        await expect(service.accept(delivery(DONE))).resolves.toBe("kept")
        expect(intake.claim.mock.calls[0]?.[1]).toEqual({
            connectionId: ACCOUNT.id,
            type: `${FAKE_COMPOSE}.render`,
            value: { renderId: "r-1", status: "done", outputUrl: FAKE_OUTPUT, provider: FAKE_COMPOSE },
        })
        expect(write).toHaveBeenCalledWith(
            expect.anything(),
            "video-render-delivery",
            { provider: FAKE_COMPOSE, connectionId: ACCOUNT.id, key: "r-1" },
            { job: "video-render.deliver", dedupeKey: `video-render-delivery:${FAKE_COMPOSE}:${ACCOUNT.id}:r-1` },
        )
        expect(outbox.allInTransaction).toBe(true)
        expect(intake.complete).not.toHaveBeenCalled()
    })

    it("admits the new row through the type's one admission, which the module registered at boot for every compose provider", async () => {
        const { service, outbox } = await build()
        await service.accept(delivery(DONE))
        expect(outbox.allInTransaction).toBe(true)
    })

    it("finishes each render once: the same completion again, or a later one of the same render, writes and fires nothing", async () => {
        const { service, write } = await build()
        await service.accept(delivery(DONE))
        await expect(service.accept(delivery(DONE))).resolves.toBe("repeat")
        await expect(service.accept(delivery(body({ id: "r-1", state: "failed" })))).resolves.toBe("repeat")
        expect(write).toHaveBeenCalledTimes(1)
    })

    it.each([
        ["a progress ping", body({ id: "r-1", state: "rendering" }), "ignored"],
        ["a body that is no JSON", Buffer.from("<xml/>"), "unreadable"],
        ["no body at all", undefined, "unreadable"],
        ["a done render with no https output", body({ id: "r-1", state: "succeeded", url: "ftp://x/r.mp4" }), "unreadable"],
    ] as const)("keeps nothing for %s (%s)", async (_name, raw, outcome) => {
        const { service, intake, write } = await build()
        await expect(service.accept(delivery(raw))).resolves.toBe(outcome)
        expect(intake.claim).not.toHaveBeenCalled()
        expect(write).not.toHaveBeenCalled()
    })

    it("keeps nothing for an account of another provider, or a provider that composes nothing", async () => {
        const other = await build({ account: { ...OWNER, provider: "veo" } })
        await expect(other.service.accept(delivery(DONE))).resolves.toBe("unknown_account")
        await expect(other.service.accept(delivery(DONE, {}, "veo"))).resolves.toBe("unknown_provider")
        expect(other.intake.claim).not.toHaveBeenCalled()
        expect(other.write).not.toHaveBeenCalled()
    })

    it("fails the request when the delivery job cannot be written, so the row is not kept without its job (the provider sends the webhook again)", async () => {
        const { service, write } = await build()
        const down = new Error("outbox down")
        write.mockRejectedValue(down)
        await expect(service.accept(delivery(DONE))).rejects.toBe(down)
    })

    it("holds a signing provider to its signature header (the port's proves), after the door proved the token", async () => {
        const { service, intake } = await build({ port: new FakeComposePort(FAKE_COMPOSE, FAKE_SIGNED) })
        await expect(service.accept(delivery(DONE, { "x-fake-signature": "nope" }))).resolves.toBe("unsigned")
        await expect(service.accept(delivery(DONE))).resolves.toBe("unsigned")
        expect(intake.claim).not.toHaveBeenCalled()
        await expect(service.accept(delivery(DONE, { "x-fake-signature": ["cred"] }))).resolves.toBe("kept")
    })
})
