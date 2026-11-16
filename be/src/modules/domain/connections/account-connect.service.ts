import { Injectable } from "@nestjs/common"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { CONNECTED_AT_FACT, type AccountConnectStep, type ConnectOutcome, type ConnectRequest } from "./account-connect.contracts"
import type { ConnectionRecord, Provider } from "./connections.contracts"
import { ConnectionsService } from "./connections.service"

/** The typed code of a step's refusal (a typed error's `code`), never its message's data. */
const codeOf = (cause: unknown): string => {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? (cause as { code: unknown }).code : undefined
    return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/u.test(code) ? code : "CONNECT_STEP_FAILED"
}

@Injectable()
/**
 * THE ONE DOOR that makes an account usable (providers concept): whatever creates or re-credentials a live account (a person's wizard, the
 * seed) asks this door, and the door runs the step the account's provider declared (`AccountConnectStep`). Creating the row is not
 * connecting it. The door is generic: it names no provider; a provider with no declared step answers `no_connect_step`.
 * Idempotent: a successful step stamps the public fact `connected_at`; an account that carries it is left as it is unless forced, and a
 * forced step registers again in place (the vendor's registration is a replace, never a second account). A refusal marks the account
 * `error` with the step's typed code (its state is honest, rule 12) and is answered, never thrown, so a caller decides what it means.
 */
export class AccountConnectService {
    private readonly steps = new Map<Provider, AccountConnectStep>()

    constructor(
        private readonly connections: ConnectionsService,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /** A provider declares its connect step once at boot; a second declaration for the same provider is a wiring error. */
    register(step: AccountConnectStep): void {
        if (this.steps.has(step.provider)) throw new Error(`a connect step for ${step.provider} is registered twice`)
        this.steps.set(step.provider, step)
    }

    /** What the door would do for a live account of a provider that is not stored yet (a dry run): no vendor call, nothing written. */
    planNew(provider: Provider): ConnectOutcome {
        const step = this.steps.get(provider)
        if (step === undefined) return { kind: "no_connect_step" }
        return this.connections.publicOrigin() === null ? { kind: "local_only" } : { kind: "would_connect", does: step.does }
    }

    /** Runs (or, dry, plans) the connect step of one stored account of the workspace; see the class for the rules. */
    async connect(workspaceId: string, connectionId: string, request: ConnectRequest): Promise<ConnectOutcome> {
        const account = await this.connections.get(workspaceId, connectionId)
        return this.connectAccount(account, request)
    }

    /** The same as `connect` for an account already read. */
    async connectAccount(account: ConnectionRecord, request: ConnectRequest): Promise<ConnectOutcome> {
        if (account.sandbox) return { kind: "sandbox" }
        const step = this.steps.get(account.provider)
        if (step === undefined) return { kind: "no_connect_step" }
        const since = account.meta[CONNECTED_AT_FACT]
        if (!request.force && since !== undefined && since !== "" && account.status !== "error") return { kind: "already_connected", since }
        const origin = this.connections.publicOrigin()
        if (origin === null) return { kind: "local_only" }
        if (request.dry) return { kind: "would_connect", does: step.does }
        try {
            await step.connect(account, origin)
        } catch (cause) {
            const code = codeOf(cause)
            await this.connections.patch(account.workspaceId, account.id, { status: "error", lastError: code })
            return { kind: "connect_refused", code, cause }
        }
        // The step may have written public facts of its own (a bot's id): stamp on top of what is stored now.
        const fresh = await this.connections.get(account.workspaceId, account.id)
        await this.connections.patch(account.workspaceId, account.id, {
            meta: { ...fresh.meta, [CONNECTED_AT_FACT]: this.clock.now().toISOString() },
            lastError: null,
            ...(fresh.status === "error" ? { status: "connected" as const } : {}),
        })
        return { kind: "connected" }
    }
}
