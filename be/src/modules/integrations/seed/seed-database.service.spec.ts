import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { Secret } from "@modules/platform/config"
import type { OwnerConnection, OwnerIsolation, OwnerStatements } from "@modules/platform/database"
import { SEED_DATABASE_CONNECT, SEED_DATABASE_URL } from "./seed.decorators"
import type { SeedDatabaseConnector } from "./seed.port"
import { SeedDatabaseService } from "./seed-database.service"

const URL_VALUE = "postgres://owner:never-printed@db:5432/app"

/** Everything one built service works with: the service, its connection and connector doubles, and the isolation levels the connection ran. */
interface Built {
    readonly service: SeedDatabaseService
    readonly connection: ReturnType<typeof mock<OwnerConnection>>
    readonly connector: ReturnType<typeof mock<SeedDatabaseConnector>>
    readonly isolations: Array<OwnerIsolation>
}

const build = async (): Promise<Built> => {
    const url = mock<Secret>()
    url.reveal.mockReturnValue(URL_VALUE)
    const connection = mock<OwnerConnection>()
    const isolations: Array<OwnerIsolation> = []
    connection.initialize.mockResolvedValue(undefined)
    connection.destroy.mockResolvedValue(undefined)
    connection.run.mockImplementation((text) => Promise.resolve([{ answer: text }]))
    connection.transaction.mockImplementation(
        (isolation: OwnerIsolation, work: (statements: OwnerStatements) => Promise<unknown>) => {
            isolations.push(isolation)
            return work(connection)
        },
    )
    const connector = mock<SeedDatabaseConnector>()
    connector.connect.mockReturnValue(connection)
    const moduleRef = await Test.createTestingModule({
        providers: [
            SeedDatabaseService,
            { provide: SEED_DATABASE_URL, useValue: url },
            { provide: SEED_DATABASE_CONNECT, useValue: connector },
        ],
    }).compile()
    return { service: moduleRef.get(SeedDatabaseService), connection, connector, isolations }
}

describe("SeedDatabaseService: the statement runner of the whole-database store", () => {
    it("opens nothing until the first statement, then one dedicated connection with the declared owner URL for every later one", async () => {
        const { service, connection, connector } = await build()
        expect(connector.connect).not.toHaveBeenCalled()

        await service.query("select 1", ["a"])
        await service.query("select 2")

        expect(connector.connect.mock.calls).toEqual([[URL_VALUE]])
        expect(connection.initialize).toHaveBeenCalledTimes(1)
        expect(connection.run.mock.calls).toEqual([
            ["select 1", ["a"]],
            ["select 2", undefined],
        ])
    })

    it("answers the rows a statement returned", async () => {
        const { service } = await build()

        expect(await service.query("select 1")).toEqual([{ answer: "select 1" }])
    })

    it("passes the isolation level through to the transaction and runs its statements in it", async () => {
        const { service, isolations, connection } = await build()

        const rows = await service.transaction("repeatable read", (tx) => tx.query("select 3", ["x"]))
        await service.transaction("read committed", (tx) => tx.query("select 4"))

        expect(isolations).toEqual(["REPEATABLE READ", "READ COMMITTED"])
        expect(rows).toEqual([{ answer: "select 3" }])
        expect(connection.run).toHaveBeenCalledWith("select 3", ["x"])
    })

    it("runs a transaction asked for inside a transaction in the same one", async () => {
        const { service, isolations, connection } = await build()

        await service.transaction("read committed", (tx) =>
            tx.transaction("repeatable read", (inner) => inner.query("select 5")),
        )

        expect(isolations).toEqual(["READ COMMITTED"])
        expect(connection.run).toHaveBeenCalledWith("select 5", undefined)
    })

    it("waits for one opening when two statements arrive together", async () => {
        const { service, connection } = await build()

        await Promise.all([service.query("select 1"), service.query("select 2")])

        expect(connection.initialize).toHaveBeenCalledTimes(1)
    })

    it("forgets a failed opening so the next statement tries again", async () => {
        const { service, connection } = await build()
        connection.initialize.mockRejectedValueOnce(new TypeError("not yet"))

        await expect(service.query("select 1")).rejects.toThrow("not yet")
        await expect(service.query("select 2")).resolves.toEqual([{ answer: "select 2" }])

        expect(connection.initialize).toHaveBeenCalledTimes(2)
    })

    it("closes the connection on shutdown only when one was opened", async () => {
        const idle = await build()
        await idle.service.onModuleDestroy()
        expect(idle.connection.destroy).not.toHaveBeenCalled()

        const used = await build()
        await used.service.query("select 1")
        await used.service.onModuleDestroy()
        await used.service.onModuleDestroy()
        expect(used.connection.destroy).toHaveBeenCalledTimes(1)
    })
})
