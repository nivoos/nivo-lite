import type { EntityManager } from "typeorm"
import { AccountDataFactsService } from "./account-data-facts.service"

/** One row of the in-memory store the fake transaction answers from. */
interface Row {
    type: string
    id: string
    workspaceId: string
    createdAt: number
    factKey: string | null
    sameFactOf: string | null
}

const WS = "ws-1"

const rowOf = (id: string, type = "sepay.transaction", workspaceId = WS, createdAt = 1): Row => ({
    type,
    id,
    workspaceId,
    createdAt,
    factKey: null,
    sameFactOf: null,
})

/** A transaction over rows in memory: the advisory lock statements are recorded, the queries the service makes are answered. */
const txOf = (rows: Array<Row>) => {
    const statements: Array<string> = []
    const builderParams: Record<string, unknown> = {}
    const builder = {
        select: () => builder,
        where: (_sql: string, params: Record<string, unknown>) => Object.assign(builderParams, params) && builder,
        andWhere: (_sql: string, params?: Record<string, unknown>) => Object.assign(builderParams, params ?? {}) && builder,
        orderBy: () => builder,
        addOrderBy: () => builder,
        limit: () => builder,
        getOne: () =>
            Promise.resolve(
                rows
                    .filter(
                        (row) =>
                            row.workspaceId === builderParams.workspaceId &&
                            row.factKey === builderParams.factKey &&
                            row.sameFactOf === null &&
                            !(row.type === builderParams.type && row.id === builderParams.id),
                    )
                    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))[0] ?? null,
            ),
    }
    const tx = {
        query: jest.fn((statement: string) => {
            statements.push(statement)
            return Promise.resolve(statement.includes("hashtextextended") ? [{ hashtextextended: "42" }] : [{}])
        }),
        findOne: (_entity: unknown, options: { where: Record<string, unknown> }) =>
            Promise.resolve(
                rows.find((row) =>
                    Object.entries(options.where).every(([key, wanted]) => {
                        const held: unknown = Reflect.get(row, key)
                        // `IsNull()` is a find operator, any other value is compared as it is.
                        return typeof wanted === "object" && wanted !== null ? held === null : held === wanted
                    }),
                ) ?? null,
            ),
        createQueryBuilder: () => builder,
        update: (_entity: unknown, where: { type: string; id: string }, patch: Partial<Row>) => {
            Object.assign(rows.find((row) => row.type === where.type && row.id === where.id) ?? {}, patch)
            return Promise.resolve()
        },
    }
    return { tx: tx as unknown as EntityManager, statements }
}

const claim = (tx: EntityManager, id: string, factKey: string, type = "sepay.transaction") =>
    new AccountDataFactsService().claim(tx, { workspaceId: WS, type, id, factKey })

describe("AccountDataFactsService (owner R97: the same fact is one fact)", () => {
    it("answers the first row of a fact as first, and writes its fact key and no earlier row", async () => {
        const rows = [rowOf("a")]
        const { tx } = txOf(rows)

        await expect(claim(tx, "a", "nivo.trigger.payment.credit.received:acc:REF1")).resolves.toEqual({ first: true })
        expect(rows[0]).toMatchObject({ factKey: "nivo.trigger.payment.credit.received:acc:REF1", sameFactOf: null })
    })

    it("answers a later row of the same fact as the same, pointing at the first, even on another type of the same verb", async () => {
        const rows = [rowOf("a", "sepay.transaction", WS, 1), rowOf("b", "casso.transaction", WS, 2)]
        const { tx } = txOf(rows)

        await claim(tx, "a", "credit:acc:REF1", "sepay.transaction")
        await expect(claim(tx, "b", "credit:acc:REF1", "casso.transaction")).resolves.toEqual({
            first: false,
            sameAs: { type: "sepay.transaction", id: "a" },
        })
        expect(rows[1]).toMatchObject({ factKey: "credit:acc:REF1", sameFactOf: "a" })
    })

    it("keeps two different keys apart, and the same key of another workspace apart", async () => {
        const rows = [rowOf("a"), rowOf("b"), rowOf("c", "sepay.transaction", "ws-2")]
        const { tx } = txOf(rows)

        await expect(claim(tx, "a", "credit:acc:REF1")).resolves.toEqual({ first: true })
        await expect(claim(tx, "b", "credit:acc:REF2")).resolves.toEqual({ first: true })
        await expect(
            new AccountDataFactsService().claim(tx, { workspaceId: "ws-2", type: "sepay.transaction", id: "c", factKey: "credit:acc:REF1" }),
        ).resolves.toEqual({ first: true })
    })

    it("takes the advisory lock on (workspace, fact key) before it reads anything", async () => {
        const { tx, statements } = txOf([rowOf("a")])

        await claim(tx, "a", "credit:acc:REF1")

        expect(statements[0]).toContain("hashtextextended")
        expect(statements[1]).toContain("pg_advisory_xact_lock")
        expect(JSON.stringify((tx.query as jest.Mock).mock.calls[0])).toContain(`account-data-fact:${WS}:credit:acc:REF1`)
    })

    it("two claims of one key in sequence under the lock: the second is the same fact, a third too, all pointing at the first", async () => {
        const rows = [rowOf("a", "sepay.transaction", WS, 5), rowOf("b", "sepay.transaction", WS, 1), rowOf("c", "sepay.transaction", WS, 2)]
        const { tx } = txOf(rows)

        // `b` and `c` were created earlier than `a` (a transaction's clock is its start): the claim order is the first, not the clock.
        await expect(claim(tx, "a", "k")).resolves.toEqual({ first: true })
        await expect(claim(tx, "b", "k")).resolves.toMatchObject({ first: false, sameAs: { id: "a" } })
        await expect(claim(tx, "c", "k")).resolves.toMatchObject({ first: false, sameAs: { id: "a" } })
    })

    it("answers again what it answered for a row that already claimed (a retried delivery goes on, a repeat stays a repeat)", async () => {
        const rows = [rowOf("a"), rowOf("b")]
        const { tx } = txOf(rows)

        await claim(tx, "a", "k")
        await claim(tx, "b", "k")

        await expect(claim(tx, "a", "k")).resolves.toEqual({ first: true })
        await expect(claim(tx, "b", "k")).resolves.toMatchObject({ first: false, sameAs: { id: "a" } })
    })
})
