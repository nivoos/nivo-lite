import type { DataRecordInput } from "@modules/domain/data-records"
import type { SandboxCase, SandboxCatalogue } from "@modules/domain/provider-sandbox"
import type { DataEntity } from "./data-hub.contracts"

/** The provider key of an owner's database account. */
export const DATABASE_SANDBOX_PROVIDER = "database"

/** The operation of the pull in the sandbox call log and in the account's next-case selector. */
export const DATABASE_PULL_OPERATION = "pull"

/** The ids of the cases, by what they prove (the implementation reads `state.nextCase` against them; DATABASE-1 is the default). */
export const DATABASE_CASE = {
    firstRead: "DATABASE-1",
    newOrders: "DATABASE-2",
    changedRow: "DATABASE-3",
    oneTableFails: "DATABASE-4",
    everyTableFails: "DATABASE-5",
    loginRefused: "DATABASE-6",
    unreachable: "DATABASE-7",
    bigTable: "DATABASE-8",
} as const

/**
 * The moments of the sandbox database (R60: a fixed history, the same on every machine). A case reads the database AS OF a moment: the
 * latest version of every row whose `asOf` is not later than it.
 */
export const DATABASE_AS_OF = { first: 1, newOrders: 2, changedRow: 3, bigTable: 4 } as const

/** One version of a row of the sandbox database: from which moment it reads, when it changed at the source and its columns. */
interface RowVersion {
    readonly asOf: number
    readonly updatedAt: string
    readonly columns: Readonly<Record<string, string | number>>
}

/** One row of a table: its id and its versions in time order. */
interface SandboxRow {
    readonly id: string
    readonly title: string
    readonly versions: ReadonlyArray<RowVersion>
}

/** One table of the sandbox database: where it is, what it becomes in the hub and its rows. */
export interface SandboxTable {
    readonly schema: string
    readonly table: string
    readonly entity: DataEntity
    readonly rows: ReadonlyArray<SandboxRow>
}

/** The key of a table, as the live sync keys the cursors in the connection's public meta (`<schema>.<table>`). */
export const databaseTableKey = (table: Pick<SandboxTable, "schema" | "table">): string => `${table.schema}.${table.table}`

/** The meta key one table's cursor is kept under, as the live sync does (`cursor:<schema>.<table>`). */
export const databaseCursorKey = (table: Pick<SandboxTable, "schema" | "table">): string => `cursor:${databaseTableKey(table)}`

/**
 * The most rows one pull takes of one table: the live reader's own bound (`DATABASE_MAX_ROWS`, integrations/data-sources
 * database-session.contracts.ts: a spec holds the two equal). The cursor then moves to the newest row taken and the next pull brings the rest.
 */
export const DATABASE_SANDBOX_PAGE_ROWS = 5000

/** How many orders the big table of DATABASE-8 holds beyond the shop's five: more than one pull takes. */
const BULK_ORDERS = 5200

/** The big table's orders DH2001 .. DH7200, one a minute from 2026-11-09 (all there from the fourth moment). */
const bulkOrders = (): ReadonlyArray<SandboxRow> =>
    Array.from({ length: BULK_ORDERS }, (_, index) => {
        const number = 2001 + index
        const updatedAt = new Date(Date.UTC(2026, 10, 9, 0, 0, 0) + index * 60_000).toISOString()
        return {
            id: String(number),
            title: `DH${String(number)}`,
            versions: [
                { asOf: DATABASE_AS_OF.bigTable, updatedAt, columns: { id: number, order_no: `DH${String(number)}`, customer_id: (index % 3) + 1, status: "new", total: 100_000 + (index % 50) * 1000 } },
            ],
        }
    })

/** The sandbox database's tables: a small shop (customers, orders, products), fixed. */
export const DATABASE_SANDBOX_TABLES: ReadonlyArray<SandboxTable> = [
    {
        schema: "public",
        table: "customers",
        entity: "customer",
        rows: [
            { id: "1", title: "Nguyen Van An", versions: [{ asOf: 1, updatedAt: "2026-11-01T08:00:00.000Z", columns: { id: 1, name: "Nguyen Van An", phone: "0900000001", email: "an.nguyen@example.com" } }] },
            { id: "2", title: "Tran Thi Binh", versions: [{ asOf: 1, updatedAt: "2026-11-01T08:05:00.000Z", columns: { id: 2, name: "Tran Thi Binh", phone: "0900000002", email: "binh.tran@example.com" } }] },
            { id: "3", title: "Le Van Cuong", versions: [{ asOf: 1, updatedAt: "2026-11-01T08:10:00.000Z", columns: { id: 3, name: "Le Van Cuong", phone: "0900000003", email: "cuong.le@example.com" } }] },
        ],
    },
    {
        schema: "public",
        table: "orders",
        entity: "order",
        rows: [
            { id: "1001", title: "DH1001", versions: [{ asOf: 1, updatedAt: "2026-11-01T09:00:00.000Z", columns: { id: 1001, order_no: "DH1001", customer_id: 1, status: "paid", total: 350_000 } }] },
            {
                id: "1002",
                title: "DH1002",
                versions: [
                    { asOf: 1, updatedAt: "2026-11-01T09:30:00.000Z", columns: { id: 1002, order_no: "DH1002", customer_id: 2, status: "new", total: 120_000 } },
                    { asOf: 3, updatedAt: "2026-11-12T11:00:00.000Z", columns: { id: 1002, order_no: "DH1002", customer_id: 2, status: "paid", total: 120_000 } },
                ],
            },
            { id: "1003", title: "DH1003", versions: [{ asOf: 1, updatedAt: "2026-11-01T10:00:00.000Z", columns: { id: 1003, order_no: "DH1003", customer_id: 3, status: "new", total: 480_000 } }] },
            { id: "1004", title: "DH1004", versions: [{ asOf: 2, updatedAt: "2026-11-08T09:00:00.000Z", columns: { id: 1004, order_no: "DH1004", customer_id: 1, status: "new", total: 90_000 } }] },
            { id: "1005", title: "DH1005", versions: [{ asOf: 2, updatedAt: "2026-11-08T09:30:00.000Z", columns: { id: 1005, order_no: "DH1005", customer_id: 2, status: "new", total: 210_000 } }] },
            ...bulkOrders(),
        ],
    },
    {
        schema: "public",
        table: "products",
        entity: "product",
        rows: [
            { id: "SKU-1", title: "Ao thun", versions: [{ asOf: 1, updatedAt: "2026-11-01T07:00:00.000Z", columns: { sku: "SKU-1", name: "Ao thun", price: 150_000, stock: 20 } }] },
            { id: "SKU-2", title: "Non luoi trai", versions: [{ asOf: 1, updatedAt: "2026-11-01T07:05:00.000Z", columns: { sku: "SKU-2", name: "Non luoi trai", price: 80_000, stock: 35 } }] },
            { id: "SKU-3", title: "Tui vai", versions: [{ asOf: 1, updatedAt: "2026-11-01T07:10:00.000Z", columns: { sku: "SKU-3", name: "Tui vai", price: 250_000, stock: 8 } }] },
        ],
    },
]

/** What one table gives a pull: the hub rows changed after the cursor (as of the moment) and the table's new cursor (the old one when nothing changed). */
export interface DatabaseTablePull {
    readonly table: SandboxTable
    readonly rows: ReadonlyArray<DataRecordInput>
    readonly cursor: string | null
}

/**
 * The rows of one table as of a moment that changed after a cursor (the newest change of the table the account already read, or null for
 * a first read), oldest change first, in the hub's row shape (`externalId` the id, `title`, `occurredAt` the change, `data` the columns plus
 * `updated_at`). The new cursor is the newest change delivered (ISO text), else the one it came with.
 */
export const databasePullOf = (table: SandboxTable, asOf: number, cursor: string | null): DatabaseTablePull => {
    const versions = table.rows.flatMap((row) => {
        const latest = row.versions.filter((version) => version.asOf <= asOf).at(-1)
        return latest !== undefined && (cursor === null || latest.updatedAt > cursor) ? [{ row, latest }] : []
    })
    // Oldest change first, at most one page (`DATABASE_SANDBOX_PAGE_ROWS`): the cursor then stands at the newest row taken, the next pull brings the rest.
    const ordered = versions.toSorted((left, right) => left.latest.updatedAt.localeCompare(right.latest.updatedAt)).slice(0, DATABASE_SANDBOX_PAGE_ROWS)
    const rows = ordered.map(({ row, latest }): DataRecordInput => ({
        externalId: row.id,
        title: row.title,
        occurredAt: new Date(latest.updatedAt),
        data: { ...latest.columns, updated_at: latest.updatedAt },
    }))
    return { table, rows, cursor: ordered.at(-1)?.latest.updatedAt ?? cursor }
}

/** The sentence the owner reads for a table the sandbox database refuses (the case DATABASE-4 and -5), after the table key. */
export const DATABASE_SANDBOX_TABLE_REFUSAL = "permission denied for table"

/** The detail the sandbox database's login refusal carries (DATABASE-6): the engine's own words. */
export const DATABASE_SANDBOX_LOGIN_REFUSAL = "password authentication failed for user"

/** The detail the unreachable database carries (DATABASE-7). */
export const DATABASE_SANDBOX_UNREACHABLE = "connection timed out"

/** The outbound cases of the database pull: the account's NEXT CASE picks what the next pull meets; DATABASE-1 answers while nothing is picked. */
export const DATABASE_SANDBOX_CASES: ReadonlyArray<SandboxCase> = [
    {
        id: DATABASE_CASE.firstRead,
        label: "A first read: the shop's 3 customers, 3 orders (DH1001-DH1003) and 3 products are brought; each table's cursor moves to its newest change",
        operation: DATABASE_PULL_OPERATION,
        outcome: "ok",
        default: true,
    },
    {
        id: DATABASE_CASE.newOrders,
        label: "New orders: two orders (DH1004, DH1005) arrived after the last cursor; only they are brought (a first read brings everything up to them)",
        operation: DATABASE_PULL_OPERATION,
        outcome: "ok",
    },
    {
        id: DATABASE_CASE.changedRow,
        label: "A changed row: order DH1002 was marked paid after it was first read; the same row comes again with the new status (the hub updates it, adds none)",
        operation: DATABASE_PULL_OPERATION,
        outcome: "ok",
    },
    {
        id: DATABASE_CASE.oneTableFails,
        label: "One table fails: the orders table is refused (permission denied); customers and products are brought, the run's note names the table",
        operation: DATABASE_PULL_OPERATION,
        outcome: "ok",
    },
    {
        id: DATABASE_CASE.everyTableFails,
        label: "Every table fails: nothing can be read; the run fails with the first table's reason",
        operation: DATABASE_PULL_OPERATION,
        outcome: "refused",
    },
    {
        id: DATABASE_CASE.loginRefused,
        label: "The login is refused: the database rejects the user and password before any table is read",
        operation: DATABASE_PULL_OPERATION,
        outcome: "refused",
    },
    {
        id: DATABASE_CASE.unreachable,
        label: "The database cannot be reached: the connection times out, nothing is read",
        operation: DATABASE_PULL_OPERATION,
        outcome: "transient",
    },
    {
        id: DATABASE_CASE.bigTable,
        label: "A big table: the orders table holds 5,205 orders; one pull takes the oldest 5,000 (the live bound) and moves the cursor to the newest taken, the next pull brings the other 205",
        operation: DATABASE_PULL_OPERATION,
        outcome: "ok",
    },
]

/** The owner's database's hardcoded catalogue, registered at boot. */
export const DATABASE_SANDBOX_CATALOGUE: SandboxCatalogue = { provider: DATABASE_SANDBOX_PROVIDER, cases: DATABASE_SANDBOX_CASES }
