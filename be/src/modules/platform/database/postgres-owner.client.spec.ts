import { Test } from "@nestjs/testing"
import { mockEntityManager, type MockEntityManager } from "@starci/jest-preset"
import { DataSource } from "typeorm"
import { openOwnerConnection } from "./postgres-owner.client"

const SUBJECT = Symbol("postgres-owner.client")

const buildSubject = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { openOwnerConnection } }],
    }).compile()
    return moduleRef.get<{ openOwnerConnection: typeof openOwnerConnection }>(SUBJECT)
}

const URL_VALUE = "postgres://owner:never-printed@db:5432/app"

describe("the owner connection", () => {
    const seen: Array<string> = []
    let managerSeen: MockEntityManager | null = null

    beforeEach(() => {
        seen.length = 0
        const manager = mockEntityManager({
            query: [
                ["select 3", [{ id: "2" }]],
                ["select 4", [{ id: "2" }]],
            ],
        })
        jest.spyOn(manager, "query")
        managerSeen = manager
        jest.spyOn(DataSource.prototype, "initialize").mockImplementation(function (this: DataSource) {
            seen.push("initialize")
            return Promise.resolve(this)
        })
        jest.spyOn(DataSource.prototype, "query").mockImplementation((text: string, params?: Array<unknown>) => {
            seen.push(`source ${text} ${JSON.stringify(params ?? null)}`)
            return Promise.resolve([{ id: "1" }])
        })
        jest.spyOn(DataSource.prototype, "destroy").mockImplementation(() => {
            seen.push("destroy")
            return Promise.resolve()
        })
        jest.spyOn(DataSource.prototype, "transaction").mockImplementation((isolation, work) => {
            seen.push(`transaction ${String(isolation)}`)
            return work(manager)
        })
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it("opens nothing until it is initialized, then runs statements as given and answers their rows", async () => {
        const subject = await buildSubject()

        const connection = subject.openOwnerConnection(URL_VALUE)
        expect(seen).toEqual([])
        await connection.initialize()
        const rows = await connection.run("select 1", ["a"])
        await connection.run("select 2")

        expect(rows).toEqual([{ id: "1" }])
        expect(seen).toEqual(["initialize", 'source select 1 ["a"]', "source select 2 null"])
    })

    it("runs a transaction under the isolation level with the manager's statements, and closes", async () => {
        const subject = await buildSubject()
        const connection = subject.openOwnerConnection(URL_VALUE)

        const rows = await connection.transaction("REPEATABLE READ", (statements) => statements.run("select 3", ["x"]))
        await connection.transaction("READ COMMITTED", (statements) => statements.run("select 4"))
        await connection.destroy()

        expect(rows).toEqual([{ id: "2" }])
        expect(seen).toEqual(["transaction REPEATABLE READ", "transaction READ COMMITTED", "destroy"])
        expect(managerSeen?.query.mock.calls).toEqual([
            ["select 3", ["x"]],
            ["select 4", undefined],
        ])
    })
})
