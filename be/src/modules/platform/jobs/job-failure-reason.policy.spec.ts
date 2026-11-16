import { Test } from "@nestjs/testing"
import { DomainError } from "@modules/platform/errors"
import { QueueError, QueueErrorCode } from "@modules/platform/queue"
import { failureReasonOf } from "./job-failure-reason.policy"

const SUBJECT = Symbol("job-failure-reason.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({ providers: [{ provide: SUBJECT, useValue: { failureReasonOf } }] }).compile()
    return moduleRef.get<{ failureReasonOf: typeof failureReasonOf }>(SUBJECT)
}

/** A coded error of THIS app's error base. */
class StoreError extends DomainError<"DATA_STORE_FAILED"> {}

/**
 * A coded error built by ANOTHER copy of the error base (a package with its own nested `@starci/common`): not an instance of this app's
 * `DomainError`, the same shape (a code, its text parameters, the cause).
 */
class ForeignRefusal extends Error {
    readonly params: Readonly<Record<string, string>>
    constructor(
        readonly code: string,
        params: Readonly<Record<string, string>>,
        cause: unknown,
    ) {
        super(code, { cause })
        this.params = params
    }
}

/** What a database driver throws: its own class and code, a message that says what is wrong. */
const driverError = (): Error =>
    Object.assign(new Error("permission denied for table records"), { name: "QueryFailedError", code: "42501" })

describe("the reason a failed job keeps: coded head + the uncoded throw under it, never a secret", () => {
    it("names the uncoded throw a coded failure wraps: its class, code and message, beside the failure's code", async () => {
        const policy = await build()
        const wrapped = new StoreError({ code: "DATA_STORE_FAILED", params: { store: "database" }, cause: driverError() })
        expect(policy.failureReasonOf(wrapped)).toBe(
            "DATA_STORE_FAILED (QueryFailedError 42501: permission denied for table records)",
        )
    })

    it("reads a coded failure of another copy of the error base by its shape, and goes on to the throw it wraps", async () => {
        const policy = await build()
        const foreign = new ForeignRefusal("DATA_STORE_FAILED", { store: "storage" }, new TypeError("fetch failed"))
        expect(policy.failureReasonOf(foreign)).toBe("DATA_STORE_FAILED (TypeError: fetch failed)")
    })

    it("names a CODED failure a coded failure wraps (the dev backup's shape: a package's refusal around the app's own refusal)", async () => {
        const policy = await build()
        class ScopeError extends DomainError<"DATA_STORES_SCOPE_REQUIRED"> {}
        const inner = new ScopeError({ code: "DATA_STORES_SCOPE_REQUIRED", params: { store: "records" } })
        const outer = new ForeignRefusal("DATA_STORE_FAILED", { store: "records" }, inner)
        expect(policy.failureReasonOf(outer)).toBe("DATA_STORE_FAILED (ScopeError DATA_STORES_SCOPE_REQUIRED)")
        const deeper = new ForeignRefusal("DATA_STORE_FAILED", {}, new StoreError({ code: "DATA_STORE_FAILED", cause: driverError() }))
        expect(policy.failureReasonOf(deeper)).toBe(
            "DATA_STORE_FAILED (StoreError DATA_STORE_FAILED <- QueryFailedError 42501: permission denied for table records)",
        )
    })

    it("an uncoded throw on its own: its class, code and message", async () => {
        const policy = await build()
        expect(policy.failureReasonOf(driverError())).toBe("QueryFailedError 42501: permission denied for table records")
        expect(policy.failureReasonOf(new Error("plain text"))).toBe("Error: plain text")
    })

    it("a flow failure keeps the reason it names, and the throw it wraps when it wraps one", async () => {
        const policy = await build()
        const named = new QueueError({ code: QueueErrorCode.FlowFailure, params: { failureClass: "config", reason: "refused" } })
        expect(policy.failureReasonOf(named)).toBe("refused")
        const wrapping = new QueueError({
            code: QueueErrorCode.FlowFailure,
            params: { failureClass: "config", reason: "refused" },
            cause: driverError(),
        })
        expect(policy.failureReasonOf(wrapping)).toBe("refused (QueryFailedError 42501: permission denied for table records)")
    })

    it("a coded failure with nothing uncoded under it: its code only (as before)", async () => {
        const policy = await build()
        expect(policy.failureReasonOf(new StoreError({ code: "DATA_STORE_FAILED", params: { store: "database" } }))).toBe(
            "DATA_STORE_FAILED",
        )
    })

    it("scrubs a credential the message carries (the platform's one redaction) and stays bounded", async () => {
        const policy = await build()
        const leaky = new Error("connect failed: password=hunter2secret host=db")
        const reason = policy.failureReasonOf(new StoreError({ code: "DATA_STORE_FAILED", params: { store: "database" }, cause: leaky }))
        expect(reason).not.toContain("hunter2secret")
        expect(reason).toContain("DATA_STORE_FAILED (Error: connect failed: password=")
        expect(policy.failureReasonOf(new Error("x".repeat(2_000))).length).toBe(500)
    })
})
