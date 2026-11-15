import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { ConnectionSecretsService } from "@modules/domain/connection-secrets"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectInbox, type Inbox } from "@modules/platform/inbox"
import { parseJsonText } from "@modules/platform/primitives"
import { ToolReceiptsError, ToolReceiptsErrorCode } from "./errors/tool-receipts.error"
import type { ToolCallResult, ToolJson, ToolReceiptOperation } from "./tool-receipts.contracts"
import { ToolReceiptEntity } from "./persistence/entities"

const PENDING: ToolCallResult = { ok: false, code: "unknown_outcome", detail: "operation_pending" }

const FAILURE_CODES: ReadonlySet<string> = new Set([
    "invalid_name",
    "unknown_tool",
    "not_granted",
    "idempotency_key_required",
    "unavailable",
    "tool_error",
    "unknown_outcome",
])
const APPROVAL_REASONS: ReadonlySet<string> = new Set([
    "ask_mode",
    "outside_write",
    "over_constraint",
    "over_limit_vnd",
    "no_rule",
    "tainted_input",
])

const isObject = (value: unknown): value is ToolJson =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** Refuses corrupt receipt data before it can become a connector answer. */
const isResult = (value: unknown): value is ToolCallResult => {
    if (!isObject(value)) return false
    if (value.ok === true) return isObject(value.value)
    if (value.ok !== false) return false
    if (value.code === "approval_required") {
        return typeof value.reason === "string" && APPROVAL_REASONS.has(value.reason)
    }
    return typeof value.code === "string" && FAILURE_CODES.has(value.code) && typeof value.detail === "string"
}

/**
 * True for a kept result that SETTLES its key, so a call asked again under the key is answered from it and never acts again: the act
 * happened (`ok`), or nobody knows whether it did (`unknown_outcome`: the pending intent of an act in flight or lost in a crash, or a
 * timeout; its own road settles it: a confirmation read, a person). Every other result says the act was NOT made at the connector (a
 * refusal, a failure typed as not unknown, a breaker open): it is no receipt, and the key's next call makes the act again. `nothingDone`
 * is the caller's word for an `ok` answer that still carries the outside's refusal of the act (a business "no", nothing changed).
 */
export const settlesKey = (result: ToolCallResult, nothingDone?: (result: ToolCallResult) => boolean): boolean => {
    if (!result.ok) return result.code === "unknown_outcome"
    return nothingDone?.(result) !== true
}

/** What a call under a key the inbox already holds does: answer what the key kept, or make the act again (the row is pending again). */
type Taken = { readonly kind: "kept"; readonly result: ToolCallResult } | { readonly kind: "again" }

@Injectable()
/**
 * Commits sealed connector intent before an external effect, so a retry cannot reissue an operation after a crash. One rule for every
 * retry of a key (an automatic rung, a re-drive, a person's Retry, a client asking again): only a result that settles the key
 * (`settlesKey`) answers it; a result that says the act was not made is kept for reading but the key's next call makes the act again,
 * with the same key and the same arguments (the key is the arguments' digest), the row pending again first.
 */
export class ToolReceiptsService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectInbox() private readonly inbox: Inbox,
        private readonly secrets: ConnectionSecretsService,
    ) {}

    /**
     * Claims and records pending intent atomically, then calls once; a retry reads the settled outcome (or the pending one), and makes
     * the call again when what the key kept says the act was not made. `remake`: the caller is a step a PERSON ran again (Retry): an
     * outcome kept unknown is then made again too (RETRY-FIX: an unknown one settles only by its declaration or a person).
     */
    async run(
        workspaceId: string,
        key: string,
        operation: ToolReceiptOperation,
        nothingDone?: (result: ToolCallResult) => boolean,
        remake = false,
    ): Promise<ToolCallResult> {
        const taken = await this.entityManager.transaction(async (manager): Promise<Taken> => {
            if (!(await this.inbox.claim("mcp.gateway", `${workspaceId}:${key}`, manager))) {
                return this.taken(workspaceId, key, manager, nothingDone, remake)
            }
            await manager.insert(ToolReceiptEntity, {
                workspaceId,
                operationKey: key,
                resultSealed: this.secrets.seal(JSON.stringify(PENDING)),
            })
            return { kind: "again" }
        })
        if (taken.kind === "kept") return taken.result
        const result = await operation()
        await this.entityManager.update(
            ToolReceiptEntity,
            { workspaceId, operationKey: key },
            { resultSealed: this.secrets.seal(JSON.stringify(result)) },
        )
        return result
    }

    /**
     * What a key the inbox already holds answers: its settled result, or the act made again when the result says it was not made (or,
     * when a person decided the Retry, when its outcome is unknown). The
     * row is made pending again only by the try that still finds the result it read (compare and set on the sealed text), so two
     * retries at once make the act once: the other reads the pending intent.
     */
    private async taken(
        workspaceId: string,
        key: string,
        manager: EntityManager,
        nothingDone: ((result: ToolCallResult) => boolean) | undefined,
        remake: boolean,
    ): Promise<Taken> {
        const row = await manager.findOne(ToolReceiptEntity, {
            select: { resultSealed: true },
            where: { workspaceId, operationKey: key },
        })
        if (row === null) throw new ToolReceiptsError({ code: ToolReceiptsErrorCode.Unreadable })
        const result = this.resultOf(row.resultSealed)
        // A PERSON's Retry (`remake`) settles what only a person may: the kept unknown outcome is made again under the same key. A kept
        // `ok` answer still answers: the act happened, a person's Retry never makes it twice.
        if (settlesKey(result, nothingDone) && !(remake && !result.ok)) return { kind: "kept", result }
        const moved = await manager.update(
            ToolReceiptEntity,
            { workspaceId, operationKey: key, resultSealed: row.resultSealed },
            { resultSealed: this.secrets.seal(JSON.stringify(PENDING)) },
        )
        return moved.affected === 1 ? { kind: "again" } : { kind: "kept", result: PENDING }
    }

    /** The result a sealed receipt keeps; corrupt receipt data is refused before it can become a connector answer. */
    private resultOf(sealed: string): ToolCallResult {
        const opened = this.secrets.open(sealed)
        if (opened.kind !== "ok") throw new ToolReceiptsError({ code: ToolReceiptsErrorCode.Unreadable })
        const parsed = parseJsonText(opened.value)
        if (!parsed.ok || !isResult(parsed.value))
            throw new ToolReceiptsError({ code: ToolReceiptsErrorCode.Unreadable })
        return parsed.value
    }
}
