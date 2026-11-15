import { mock } from "@starci/jest-preset"
import type { EntityManager } from "typeorm"
import type { ConnectionSecretsService } from "@modules/domain/connection-secrets"
import { ToolReceiptsService } from "@modules/domain/tool-receipts"
import type { Inbox } from "@modules/platform/inbox"

// The gateway's durable receipt (`ToolReceiptsService`, the REAL rules) over an in-memory `mcp_gateway_receipts` table, a claim-once
// inbox and a sealer that keeps the text readable: what a world puts behind its door's write calls so a retry meets the receipt a run
// before it left, as the app does (RETRY-FIX: R9 replayed a recorded `unavailable` from that table).

/** The rows of the in-memory receipts table: the sealed result by `<workspace>|<operation key>`. */
export type ReceiptRows = Map<string, string>

/** One member of a `where` or `set` object, as text, or undefined. */
const textAt = (value: unknown, member: string): string | undefined => {
    const found: unknown = typeof value === "object" && value !== null ? Reflect.get(value, member) : undefined
    return typeof found === "string" ? found : undefined
}

/** The row id of a `where` / row object (`workspaceId` + `operationKey`). */
const idOf = (value: unknown): string => `${textAt(value, "workspaceId") ?? ""}|${textAt(value, "operationKey") ?? ""}`

/** The in-memory entity manager of the receipts table: one transaction is the manager itself (one process, no concurrency). */
const managerOf = (rows: ReceiptRows): EntityManager => {
    const manager = mock<EntityManager>()
    manager.insert.mockImplementation((_entity: unknown, row: unknown) => {
        rows.set(idOf(row), textAt(row, "resultSealed") ?? "")
        return Promise.resolve(mock())
    })
    manager.findOne.mockImplementation((_entity: unknown, options: unknown) => {
        const where: unknown = typeof options === "object" && options !== null ? Reflect.get(options, "where") : null
        const sealed = rows.get(idOf(where))
        return Promise.resolve(sealed === undefined ? null : { resultSealed: sealed })
    })
    manager.update.mockImplementation((_entity: unknown, where: unknown, set: unknown) => {
        const id = idOf(where)
        const current = rows.get(id)
        const expected = textAt(where, "resultSealed")
        const moved = current !== undefined && (expected === undefined || expected === current)
        if (moved) rows.set(id, textAt(set, "resultSealed") ?? "")
        return Promise.resolve({ affected: moved ? 1 : 0, raw: [], generatedMaps: [] })
    })
    manager.transaction.mockImplementation((...args: ReadonlyArray<unknown>) => {
        const work = args.find((arg): arg is (tx: EntityManager) => Promise<unknown> => typeof arg === "function")
        return work === undefined ? Promise.resolve(undefined) : work(manager)
    })
    return manager
}

/** The inbox's claim once per source and event id. */
const inboxOf = (): Inbox => {
    const claimed = new Set<string>()
    return {
        claim: (source, eventId) => {
            const id = `${source}|${eventId ?? ""}`
            const first = !claimed.has(id)
            claimed.add(id)
            return Promise.resolve(first)
        },
    }
}

/** A sealer whose sealed text names each seal apart (as a real cipher's nonce does) and opens back to the plain text. */
const secretsOf = (): ConnectionSecretsService => {
    let seals = 0
    const secrets = mock<ConnectionSecretsService>()
    secrets.seal.mockImplementation((plain: string) => {
        seals += 1
        return `sealed:${String(seals)}:${plain}`
    })
    secrets.open.mockImplementation((sealed: string) => {
        const text = sealed.slice(sealed.indexOf(":", "sealed:".length) + 1)
        return { kind: "ok", value: text }
    })
    return secrets
}

/** The REAL receipts service over an in-memory table, and the table itself. */
export const memoryToolReceipts = (): { readonly receipts: ToolReceiptsService; readonly rows: ReceiptRows } => {
    const rows: ReceiptRows = new Map()
    return { receipts: new ToolReceiptsService(managerOf(rows), inboxOf(), secretsOf()), rows }
}
