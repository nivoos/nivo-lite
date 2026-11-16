import { buildRunner, deliveryOf, networkDown, startsOf } from "@tests/fixtures/builders/provider-connections.builder"
import { buildZalo } from "@tests/fixtures/builders/zalo-credentials-chain.builder"
import { NOW, secretOf, startedAuthorization, stored, tokens, zaloRefusal } from "@tests/fixtures/builders/zalo-credentials.builder"
import { ZaloError, ZaloErrorCode } from "@modules/integrations/zalo"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { COMPLETE_ZALO_AUTHORIZATION_JOB, type ZaloAuthorizationPayload } from "@modules/queues/zalo-authorization"
import { REFRESH_ZALO_CONNECTION_JOB, type ZaloRefreshConnectionPayload } from "@modules/queues/zalo-refresh"
import { ZALO_AUTHORIZATION_FAILED_REASON } from "./messages/channels.messages"
import type { ZaloCredentialsService } from "./zalo-credentials.service"

/** The processor of one connection's renewal as the feature composes it: one domain method. */
class RefreshProcessor extends FencedProcessor {
    override readonly queue = "zalo_refresh"
    override readonly definition: JobDefinition<ZaloRefreshConnectionPayload> = REFRESH_ZALO_CONNECTION_JOB
    constructor(private readonly credentials: ZaloCredentialsService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.credentials.renewFromJob(job.payload)
    }
}

/** The processor of the authorization job as the feature composes it: one domain method, the dead letter marks the connection. */
class AuthorizationProcessor extends FencedProcessor {
    override readonly queue = "zalo_authorization"
    override readonly definition: JobDefinition<ZaloAuthorizationPayload> = COMPLETE_ZALO_AUTHORIZATION_JOB
    constructor(private readonly credentials: ZaloCredentialsService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.credentials.completeFromJob(job.payload)
    }
    override async onFailed(delivery: QueueDelivery, _cause: unknown): Promise<void> {
        await this.credentials.authorizationFailed(delivery.payload)
    }
}

const renewal = { workspaceId: "ws-1", connectionId: "c-1", expiresAt: NOW + 60_000 }
const authorization = { workspaceId: "ws-1", state: "c-1.nonce-1", code: "code-1", oaId: "oa-9" }
const unavailable = (): ZaloError => new ZaloError({ code: ZaloErrorCode.Unavailable })

describe("zalo refresh chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("Zalo down: the background ladder 5, 10, 20 s, then one dead letter; the resume renews once Zalo answers and raises nothing again", async () => {
        const t = await buildZalo()
        const run = await buildRunner()
        const processor = new RefreshProcessor(t.service)
        t.secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 60_000))
        t.zalo.refreshTokens.mockRejectedValue(unavailable())
        run.claimed(renewal)

        const seen = await startsOf(run.runner, processor, (attempt) => deliveryOf("zalo_refresh", "zalo_refresh.connection", renewal, attempt), 4)

        expect(seen).toEqual([5, 10, 20, "returned"])
        expect(t.zalo.refreshTokens).toHaveBeenCalledTimes(4)
        expect(run.claims.park).toHaveBeenCalledTimes(1)
        expect(run.claims.park.mock.calls[0]?.[0]).toMatchObject({ failureClass: "transient", queue: "zalo_refresh" })
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(run.deadLetters.raise.mock.calls[0]?.[0]).toMatchObject({ kind: "flow-parked", flowKind: "x", failureClass: "transient", episode: 0 })
        // Each failed act released its intent: the cause fixed, the resume acts once and keeps its answer.
        expect(t.ledger.keys()).toEqual([])
        expect(t.connections.markFailing).not.toHaveBeenCalled()

        const resumed = await buildRunner(1)
        t.zalo.refreshTokens.mockResolvedValue(tokens)
        resumed.claimed(renewal)
        await resumed.runner.run(processor, deliveryOf("zalo_refresh", "zalo_refresh.connection", renewal, 1))

        expect(t.zalo.refreshTokens).toHaveBeenCalledTimes(5)
        expect(t.secrets.save).toHaveBeenCalledTimes(1)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.claims.park).not.toHaveBeenCalled()
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("Zalo refuses the refresh token: no retry (a refusal is input), the connection reads failing, ONE dead letter at once; after the owner reconnected the resume ends without a call", async () => {
        const t = await buildZalo()
        const run = await buildRunner()
        const processor = new RefreshProcessor(t.service)
        t.secretReads.secretOf.mockResolvedValue(stored(secretOf(), NOW + 60_000))
        t.zalo.refreshTokens.mockRejectedValue(zaloRefusal(-118))
        run.claimed(renewal)

        await run.runner.run(processor, deliveryOf("zalo_refresh", "zalo_refresh.connection", renewal, 1))

        expect(t.zalo.refreshTokens).toHaveBeenCalledTimes(1)
        expect(run.claims.park.mock.calls[0]?.[0]).toMatchObject({ failureClass: "input" })
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.connections.markFailing).toHaveBeenCalledTimes(1)
        expect(t.connections.markFailing).toHaveBeenCalledWith("c-1", expect.stringContaining("Zalo OA"))

        // The owner authorized again: the connection holds a new pair and a new token end.
        t.secretReads.secretOf.mockResolvedValue(stored(secretOf({ renewalToken: "fresh-refresh" }), NOW + 3_600_000))
        const resumed = await buildRunner(1)
        resumed.claimed(renewal)
        await resumed.runner.run(processor, deliveryOf("zalo_refresh", "zalo_refresh.connection", renewal, 1))

        expect(t.zalo.refreshTokens).toHaveBeenCalledTimes(1)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
    })

    it("a delivery that crashed on every start (past its ladder) is parked without running, and spends no refresh token", async () => {
        const t = await buildZalo()
        const run = await buildRunner()
        const processor = new RefreshProcessor(t.service)
        run.claimed(renewal)

        await run.runner.run(processor, deliveryOf("zalo_refresh", "zalo_refresh.connection", renewal, 5))

        expect(t.zalo.refreshTokens).not.toHaveBeenCalled()
        expect(run.claims.park.mock.calls[0]?.[0]).toMatchObject({ failureClass: "transient", reason: "crashed: started past its ladder" })
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
    })

    it("a payload the declaration refuses is a dead letter at once, before any work", async () => {
        const t = await buildZalo()
        const run = await buildRunner()
        const processor = new RefreshProcessor(t.service)
        run.claimed({ connectionId: "c-1" })

        await run.runner.run(processor, deliveryOf("zalo_refresh", "zalo_refresh.connection", { connectionId: "c-1" }, 1))

        expect(t.secretReads.secretOf).not.toHaveBeenCalled()
        expect(run.claims.park.mock.calls[0]?.[0]).toMatchObject({ failureClass: "input", reason: "payload refused: zalo_refresh.connection" })
    })
})

describe("zalo authorization chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("Zalo down: the waited ladder 1, 2, 4, 8 min, then one dead letter that marks the connection failing once; the resume completes the authorization", async () => {
        const t = await buildZalo()
        const run = await buildRunner()
        const processor = new AuthorizationProcessor(t.service)
        t.secretReads.secretOf.mockResolvedValue(startedAuthorization())
        t.zalo.exchangeCode.mockRejectedValue(networkDown())
        run.claimed(authorization)

        const seen = await startsOf(run.runner, processor, (attempt) => deliveryOf("zalo_authorization", "complete-zalo-authorization", authorization, attempt), 5)

        expect(seen).toEqual([60, 120, 240, 480, "returned"])
        expect(t.zalo.exchangeCode).toHaveBeenCalledTimes(5)
        expect(run.claims.park).toHaveBeenCalledTimes(1)
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        // The dead letter's failure hook wrote the state the owner reads on the connection; the retries wrote nothing.
        expect(t.connections.markFailing.mock.calls).toEqual([["c-1", ZALO_AUTHORIZATION_FAILED_REASON]])
        expect(t.connections.applyZaloAuthorization).not.toHaveBeenCalled()
        expect(t.bus.writes).toHaveLength(0)

        const resumed = await buildRunner(1)
        t.zalo.exchangeCode.mockResolvedValue(tokens)
        resumed.claimed(authorization)
        await resumed.runner.run(processor, deliveryOf("zalo_authorization", "complete-zalo-authorization", authorization, 1))

        expect(t.zalo.exchangeCode).toHaveBeenCalledTimes(6)
        expect(t.connections.applyZaloAuthorization).toHaveBeenCalledTimes(1)
        expect(t.bus.writes).toHaveLength(1)
        expect(t.connections.markFailing).toHaveBeenCalledTimes(1)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("a code Zalo refuses ends the authorization as a typed answer: the connection is marked, the job completes, nothing is parked and no item is raised", async () => {
        const t = await buildZalo()
        const run = await buildRunner()
        const processor = new AuthorizationProcessor(t.service)
        t.secretReads.secretOf.mockResolvedValue(startedAuthorization())
        t.zalo.exchangeCode.mockRejectedValue(zaloRefusal(-14014))
        run.claimed(authorization)

        await run.runner.run(processor, deliveryOf("zalo_authorization", "complete-zalo-authorization", authorization, 1))

        expect(t.zalo.exchangeCode).toHaveBeenCalledTimes(1)
        expect(t.connections.markFailing.mock.calls).toEqual([["c-1", ZALO_AUTHORIZATION_FAILED_REASON]])
        expect(run.claims.complete).toHaveBeenCalledTimes(1)
        expect(run.claims.park).not.toHaveBeenCalled()
        expect(run.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("a credential that cannot be read is no refusal of the owner: it parks at once as input with one item, and marks the connection through the failure hook", async () => {
        const t = await buildZalo()
        const run = await buildRunner()
        const processor = new AuthorizationProcessor(t.service)
        t.secretReads.secretOf.mockResolvedValue(stored("not json"))
        run.claimed(authorization)

        await run.runner.run(processor, deliveryOf("zalo_authorization", "complete-zalo-authorization", authorization, 1))

        expect(run.claims.park.mock.calls[0]?.[0]).toMatchObject({ failureClass: "input" })
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.connections.markFailing.mock.calls).toEqual([["c-1", ZALO_AUTHORIZATION_FAILED_REASON]])
        expect(t.zalo.exchangeCode).not.toHaveBeenCalled()
    })
})
