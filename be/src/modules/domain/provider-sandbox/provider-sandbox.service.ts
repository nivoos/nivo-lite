import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import type {
    ProviderSandboxSwitch,
    SandboxAccount,
    SandboxCall,
    SandboxCallOutcome,
    SandboxCallPlan,
    SandboxInboundCase,
    SandboxInput,
    SandboxState,
    SandboxWebhookEvent,
} from "./provider-sandbox.contracts"
import { InjectProviderSandboxStore, InjectProviderSandboxSwitch, InjectSandboxWebOrigin } from "./provider-sandbox.decorators"
import type { ProviderSandboxStore } from "./provider-sandbox-store.port"
import { ProviderSandboxError, ProviderSandboxErrorCode } from "./errors/provider-sandbox.error"

/** The state name the account's NEXT CASE selector is kept under, keyed by the operation (R62). */
export const NEXT_CASE_STATE = "next-case"

/** The operation an inbound case's send is logged under (its key is the case id). */
export const INBOUND_OPERATION = "inbound"

/** The word a thrown error is logged under: its `code` when it has one (a DomainError), else its name. */
const thrownWordOf = (cause: unknown): string => {
    if (cause instanceof Error) {
        const code: unknown = Reflect.get(cause, "code")
        return typeof code === "string" ? code : cause.name
    }
    return "unknown"
}

/** One call's step as its transaction ends: the answer, or how to throw the answer's own error again once the step committed. */
type SandboxStep<Answer> = { readonly answered: true; readonly answer: Answer } | { readonly answered: false; readonly again: () => Promise<never> }

@Injectable()
/**
 * THE GENERIC FRAME every provider's sandbox implementation answers through (lane concept provider-sandbox): the sandbox must be
 * switched on (dev only, R60) and the account a SANDBOX one; the provider's answer reads its hardcoded case, the account's NEXT CASE
 * of the operation (R62) and its STATE (`SandboxState`: what earlier calls changed, the running number of the operation), may change
 * it, and throws its live twin's error for a failing case. Every call is logged with what it came to BEFORE the caller sees it, so a
 * test reads back exactly what the provider was asked to do. It adds no idempotency of its own, knows no provider and calls no network.
 */
export class ProviderSandboxService {
    constructor(
        @InjectProviderSandboxStore() private readonly store: ProviderSandboxStore,
        @InjectProviderSandboxSwitch() private readonly switched: ProviderSandboxSwitch,
        @InjectSandboxWebOrigin() private readonly webOrigin?: string,
    ) {}

    /**
     * The address of the pretend payment page of a pay link of a sandbox account: `<web origin>/workspaces/<workspace id>/sandbox/pay/<link id>`
     * (the page that says "NIVO Sandbox: thanh toán giả"); without a web origin, the reserved host `https://sandbox.invalid/pay/<link id>`
     * that can never resolve, so nobody who opens it lands on the provider.
     */
    payPageUrl(account: SandboxAccount, linkId: string): string {
        const id = encodeURIComponent(linkId)
        return this.webOrigin === undefined || this.webOrigin === ""
            ? `https://sandbox.invalid/pay/${id}`
            : `${this.webOrigin.replace(/\/+$/u, "")}/workspaces/${encodeURIComponent(account.workspaceId)}/sandbox/pay/${id}`
    }

    /** One kept value of (name, key) of the account's state, read with no call logged; a live account or the switch off is refused. */
    async kept(account: SandboxAccount, name: string, key: string): Promise<unknown> {
        this.assertOpen(account)
        return (await this.store.stateOf(account, name, key))?.value ?? null
    }

    /** Whether the sandbox is on in this environment (what the Sandbox page reads). */
    enabled(): boolean {
        return this.switched.enabled
    }

    /** Refuses unless the sandbox is on and the account is a sandbox one. */
    assertOpen(account: SandboxAccount): void {
        if (!this.switched.enabled) throw new ProviderSandboxError({ code: ProviderSandboxErrorCode.Off })
        if (account.sandbox !== true) {
            throw new ProviderSandboxError({ code: ProviderSandboxErrorCode.LiveAccount, params: { connectionId: account.id } })
        }
    }

    /** Answers one call of `operation` on a sandbox account by the plan's key; a live account, or the sandbox off, is refused. */
    async call<Answer>(account: SandboxAccount, operation: string, request: unknown, plan: SandboxCallPlan<Answer>): Promise<Answer> {
        this.assertOpen(account)
        if (plan.lock === "outside") return await this.settled(await this.answered(account, operation, request, plan))
        // The account's lock holds the read of the running number (`state.seq`), the answer and the log as ONE step: parallel calls of an
        // account answer one after the other, each with its own number, so no two draw the same running id. Every read and write of
        // the step goes through the lock's OWN transaction (`manager`): a connection holding the lock never waits for another of the
        // pool (D3-W1-6). A thrown answer is logged in that transaction too and thrown only after it committed, so its log and the
        // state it changed before throwing stay, as they did when they were written apart.
        return await this.settled(await this.store.serialized(account, (manager) => this.answered(account, operation, request, plan, manager)))
    }

    /**
     * Picks the account's NEXT CASE of an outbound operation (R62). STICKY until changed: every later call of the operation answers it, so
     * a retry sees the same outcome; picking the default case again is how the owner goes back to success. The caller checked the id
     * against the provider's catalogue.
     */
    async setNextCase(account: SandboxAccount, operation: string, caseId: string): Promise<void> {
        this.assertOpen(account)
        await this.store.keepState(account, NEXT_CASE_STATE, operation, caseId)
    }

    /** The case the account's selector names for an operation, or null (the provider's default answers). */
    async nextCaseOf(account: SandboxAccount, operation: string): Promise<string | null> {
        this.assertOpen(account)
        return this.pickedOf(account, operation)
    }

    /**
     * Builds the webhook call(s) of one inbound case for a sandbox account (R62: the case's transformation of the inputs, given the moment
     * and the account's state), logged as one call of `inbound` keyed by the case id, so the page's log shows every send.
     */
    inbound(
        account: SandboxAccount,
        caseId: string,
        inbound: SandboxInboundCase,
        input: SandboxInput,
        at: Date,
    ): Promise<ReadonlyArray<SandboxWebhookEvent>> {
        return this.call(account, INBOUND_OPERATION, { caseId, input }, {
            key: caseId,
            answer: (state) => inbound.eventsOf(input, { connectionId: account.id, at, state }),
        })
    }

    /** The calls the account's sandbox implementations took, oldest first; of one operation when it is named. */
    async calls(account: SandboxAccount, operation?: string): Promise<ReadonlyArray<SandboxCall>> {
        this.assertOpen(account)
        return await this.store.calls(account, operation)
    }

    /** Forgets the account's state and call log (back to its hardcoded catalogue). */
    async reset(account: SandboxAccount): Promise<void> {
        this.assertOpen(account)
        await this.store.reset(account)
    }

    /** One call's step: its state, its answer, its log, all on `manager` when it is given; a throw comes back as an outcome. */
    private async answered<Answer>(
        account: SandboxAccount,
        operation: string,
        request: unknown,
        plan: SandboxCallPlan<Answer>,
        manager?: EntityManager,
    ): Promise<SandboxStep<Answer>> {
        const key = plan.key ?? ""
        const state = await this.stateOf(account, operation, manager)
        let answer: Answer
        try {
            answer = await plan.answer(state)
        } catch (cause) {
            await this.log(account, operation, key, request, { outcome: "threw", error: thrownWordOf(cause) }, manager)
            // Thrown again only after the step's transaction committed (its log and the state it changed stay).
            return { answered: false, again: () => Promise.reject(cause) }
        }
        await this.log(account, operation, key, request, { outcome: "answered", value: answer }, manager)
        return { answered: true, answer }
    }

    /** The answer of a settled step, or the answer's own error again, as its live twin throws it. */
    private async settled<Answer>(step: SandboxStep<Answer>): Promise<Answer> {
        return step.answered ? step.answer : await step.again()
    }

    private async stateOf(account: SandboxAccount, operation: string, manager?: EntityManager): Promise<SandboxState> {
        const seq = await this.store.countCalls(account, operation, manager)
        return {
            seq,
            nextCase: await this.pickedOf(account, operation, manager),
            read: async (name, key) => (await this.store.stateOf(account, name, key, manager))?.value ?? null,
            write: (name, key, value) => this.store.keepState(account, name, key, value, manager),
        }
    }

    private async pickedOf(account: SandboxAccount, operation: string, manager?: EntityManager): Promise<string | null> {
        const kept = (await this.store.stateOf(account, NEXT_CASE_STATE, operation, manager))?.value
        return typeof kept === "string" && kept !== "" ? kept : null
    }

    private log(
        account: SandboxAccount,
        operation: string,
        key: string,
        request: unknown,
        result: SandboxCallOutcome,
        manager?: EntityManager,
    ): Promise<void> {
        return this.store.logCall(account, { operation, key, request, result }, manager)
    }
}
