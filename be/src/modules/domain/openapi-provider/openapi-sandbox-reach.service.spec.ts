import { readFileSync } from "node:fs"
import { readDocument, responseSchemaOf, violationOf, type PinnedDocument, type PinnedOperation } from "@modules/domain/openapi-tools"
import { ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import { OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE, OPENAPI_SANDBOX_CATALOGUE, OPENAPI_SANDBOX_SLOW_MS } from "./openapi-sandbox.catalogue"
import type { OpenApiReachAccount, OpenApiReachCall } from "./openapi-reach.contracts"
import type { OpenApiSandboxOperationFixture } from "./openapi-sandbox-fixtures.contracts"
import { OpenApiSandboxFixturesRegistryService } from "./openapi-sandbox-fixtures-registry.service"
import { OPENAPI_SANDBOX_KEY_VALUE, OpenApiSandboxReachService } from "./openapi-sandbox-reach.service"

/*
 * The generic store, proven on a small document of a system that is no CRM (a lending library: books, members, loans), in the package's
 * own words: the engine reads the document's paths and schemas and the package's data, never a noun. The CRM document is proven in
 * `openapi-sandbox-store.spec.ts`.
 */

const BASE = sandboxAccount({ id: "conn-lib", workspaceId: "ws-1", provider: "openapi" })
const ACCOUNT: OpenApiReachAccount = { ...BASE, connector: "crm.lib" }
const OTHER: OpenApiReachAccount = { ...ACCOUNT, id: "conn-lib-2" }
const LIVE: OpenApiReachAccount = { ...ACCOUNT, id: "conn-live", sandbox: false }
const AUTH = { baseUrl: "https://lib.example.test/api", authType: "bearer" as const, authName: "" }

const json = (ref: string) => ({ content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } })
const problem = { "4XX": json("Problem"), "5XX": json("Problem") }

/** The library's document: a base path, collections with item paths, an act below an item, children of an item, a whole-collection read. */
const LIBRARY = {
    openapi: "3.1.0",
    info: { title: "Library", version: "1" },
    servers: [{ url: "https://lib.example.test/api" }],
    paths: {
        "/api/books": {
            get: {
                operationId: "book.list",
                parameters: [
                    { name: "genre", in: "query", schema: { type: "string" } },
                    { name: "limit", in: "query", schema: { type: "integer" } },
                ],
                responses: { "200": json("BookPage"), ...problem },
            },
            post: {
                operationId: "book.add",
                parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,200}$" } }],
                requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/NewBook" } } } },
                responses: { "201": json("Book"), ...problem },
            },
        },
        "/api/books/{isbn}": {
            parameters: [{ name: "isbn", in: "path", required: true, schema: { type: "string" } }],
            get: { operationId: "book.get", responses: { "200": json("Book"), ...problem } },
            patch: {
                operationId: "book.update",
                requestBody: { content: { "application/json": { schema: { type: "object", properties: { copies: { type: "integer" } } } } } },
                responses: { "200": json("Book"), ...problem },
            },
            delete: { operationId: "book.remove", responses: { "200": json("Book"), ...problem } },
        },
        "/api/books/{isbn}/hold": {
            parameters: [{ name: "isbn", in: "path", required: true, schema: { type: "string" } }],
            post: { operationId: "book.hold", responses: { "200": json("Book"), ...problem } },
        },
        "/api/members": { get: { operationId: "member.list", responses: { "200": json("MemberPage"), ...problem } } },
        "/api/members/{memberId}": {
            parameters: [{ name: "memberId", in: "path", required: true, schema: { type: "string" } }],
            get: { operationId: "member.get", responses: { "200": json("Member"), ...problem } },
        },
        "/api/members/{memberId}/loans": {
            parameters: [{ name: "memberId", in: "path", required: true, schema: { type: "string" } }],
            get: { operationId: "member.loan.list", responses: { "200": json("LoanPage"), ...problem } },
        },
        "/api/loans": {
            post: {
                operationId: "loan.open",
                requestBody: {
                    content: {
                        "application/json": {
                            schema: { type: "object", required: ["isbn", "memberId"], properties: { isbn: { type: "string" }, memberId: { type: "string" } } },
                        },
                    },
                },
                responses: { "201": json("Loan"), ...problem },
            },
        },
        "/api/stats": { get: { operationId: "stat.get", responses: { "200": json("Stats"), ...problem } } },
    },
    components: {
        schemas: {
            NewBook: { type: "object", required: ["title"], properties: { isbn: { type: "string" }, title: { type: "string" }, genre: { type: "string" } } },
            Book: {
                type: "object",
                required: ["isbn", "title", "genre", "copies", "onHold"],
                properties: {
                    isbn: { type: "string" },
                    title: { type: "string", minLength: 1 },
                    genre: { type: "string", enum: ["novel", "poetry"] },
                    copies: { type: "integer", minimum: 0 },
                    onHold: { type: "boolean" },
                },
            },
            BookPage: {
                type: "object",
                required: ["items", "nextCursor"],
                properties: { items: { type: "array", maxItems: 3, items: { $ref: "#/components/schemas/Book" } }, nextCursor: { type: "string", nullable: true } },
            },
            Member: { type: "object", required: ["memberId", "name"], properties: { memberId: { type: "string" }, name: { type: "string" } } },
            MemberPage: { type: "object", required: ["items"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/Member" } } } },
            Loan: {
                type: "object",
                required: ["id", "isbn", "memberId", "title", "state"],
                properties: {
                    id: { type: "string" },
                    isbn: { type: "string" },
                    memberId: { type: "string" },
                    title: { type: "string" },
                    name: { type: "string" },
                    state: { type: "string", enum: ["open", "returned"] },
                },
            },
            LoanPage: { type: "object", required: ["items"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/Loan" } } } },
            Stats: {
                type: "object",
                required: ["books", "loans", "label"],
                properties: { books: { type: "integer" }, loans: { type: "integer" }, label: { type: "string" } },
            },
            Problem: { type: "object", required: ["code"], properties: { code: { type: "string" }, message: { type: "string" } } },
        },
    },
}

const readLibrary = (): PinnedDocument => {
    const reading = readDocument(JSON.stringify(LIBRARY), "crm.lib")
    if (!reading.ok) throw new Error(reading.problem)
    return reading.document
}

const DOCUMENT = readLibrary()

/** The library package's declarations: the books and members it starts with, what a hold sets, its own refusal of an add. */
const DECLARED: Readonly<Record<string, OpenApiSandboxOperationFixture>> = {
    "book.list": {
        status: 200,
        body: {
            items: [
                { isbn: "978-1", title: "Rivers", genre: "novel", copies: 2, onHold: false },
                { isbn: "978-2", title: "Hills", genre: "poetry", copies: 1, onHold: false },
            ],
            nextCursor: null,
        },
        listsBack: { collection: "books", listField: "items" },
    },
    "member.list": { status: 200, body: { items: [{ memberId: "M-1", name: "Reader One" }] }, listsBack: { collection: "members", listField: "items" } },
    "book.hold": { status: 200, body: { onHold: true }, keeps: { collection: "books", keyField: "isbn" } },
    "book.add": { status: 201, body: { genre: "novel", copies: 1 }, keeps: { collection: "books", keyField: "isbn" }, refused: { status: 409, body: { code: "book_exists" } } },
}

const registryOf = (operations: Readonly<Record<string, OpenApiSandboxOperationFixture>> = DECLARED) => {
    const registry = new OpenApiSandboxFixturesRegistryService()
    registry.register({ connector: "crm.lib", document: DOCUMENT, operations })
    return registry
}

const operationOf = (operationId: string): PinnedOperation => {
    const found = [...DOCUMENT.operations.values()].find((one) => one.operationId === operationId)
    if (found === undefined) throw new Error(operationId)
    return found
}

const callOf = (operationId: string, input: Readonly<Record<string, unknown>> = {}): OpenApiReachCall => {
    const operation = operationOf(operationId)
    return {
        baseUrl: AUTH.baseUrl,
        operationId,
        method: operation.method,
        path: operation.path,
        params: [],
        hasBody: input["body"] !== undefined,
        input,
        key: null,
        maxBytes: 10_000,
    }
}

const setup = (operations?: Readonly<Record<string, OpenApiSandboxOperationFixture>>) => {
    const { sandbox, store } = sandboxServiceOf(ACCOUNT, OTHER)
    return { sandbox, store, service: new OpenApiSandboxReachService(sandbox, registryOf(operations)) }
}

const bodyOf = (text: string): unknown => JSON.parse(text)

/** The answer of a call, judged against the schema its status declares (the judge a live answer meets). */
const fits = (operationId: string, status: number, text: string): string | null => {
    const schema = responseSchemaOf(operationOf(operationId), status)
    if (schema === undefined) return `status ${String(status)} not declared`
    return schema === null ? null : violationOf(schema, bodyOf(text))
}

describe("OpenApiSandboxReachService: the generic store (second kind: a library document)", () => {
    it("starts the account with the package's records: listed, read by key, filtered by a parameter that is a member, cut to the schema's bound", async () => {
        const { service } = setup()
        const listed = await service.call(ACCOUNT, callOf("book.list", { limit: 10 }))
        expect([listed.status, fits("book.list", 200, listed.text)]).toEqual([200, null])
        expect(bodyOf(listed.text)).toMatchObject({ items: [{ isbn: "978-1" }, { isbn: "978-2" }], nextCursor: null })
        expect(bodyOf((await service.call(ACCOUNT, callOf("book.list", { genre: "poetry" }))).text)).toMatchObject({ items: [{ isbn: "978-2" }] })
        const read = await service.call(ACCOUNT, callOf("book.get", { isbn: "978-1" }))
        expect(bodyOf(read.text)).toEqual({ isbn: "978-1", title: "Rivers", genre: "novel", copies: 2, onHold: false })
    })

    it("creates with a generated uuid-shaped key, the package's base members and the schema's defaults; reads it back; an unknown key is 404 in the document's shape", async () => {
        const { service } = setup()
        const added = await service.call(ACCOUNT, callOf("book.add", { body: { title: "Seas" } }))
        expect([added.status, fits("book.add", 201, added.text)]).toEqual([201, null])
        const book = bodyOf(added.text) as { isbn: string }
        expect(book).toEqual({ isbn: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u), title: "Seas", genre: "novel", copies: 1, onHold: false })
        expect(bodyOf((await service.call(ACCOUNT, callOf("book.get", { isbn: book.isbn }))).text)).toEqual(book)
        const missing = await service.call(ACCOUNT, callOf("book.get", { isbn: "nope" }))
        expect([missing.status, bodyOf(missing.text), fits("book.get", 404, missing.text)]).toEqual([404, expect.objectContaining({ code: "not_found" }), null])
    })

    it("an act below an item lays the package's members and the call's body over the item; a change and a removal are kept", async () => {
        const { service } = setup()
        expect(bodyOf((await service.call(ACCOUNT, callOf("book.hold", { isbn: "978-2" }))).text)).toMatchObject({ isbn: "978-2", onHold: true })
        expect(bodyOf((await service.call(ACCOUNT, callOf("book.update", { isbn: "978-2", body: { copies: 5 } }))).text)).toMatchObject({ copies: 5, onHold: true })
        expect((await service.call(ACCOUNT, callOf("book.hold", { isbn: "nope" }))).status).toBe(404)
        expect((await service.call(ACCOUNT, callOf("book.remove", { isbn: "978-1" }))).status).toBe(200)
        expect((await service.call(ACCOUNT, callOf("book.get", { isbn: "978-1" }))).status).toBe(404)
    })

    it("a created record that names records of other collections borrows their members by name; children of an item list it; a summary counts the collections", async () => {
        const { service } = setup()
        const opened = await service.call(ACCOUNT, callOf("loan.open", { body: { isbn: "978-1", memberId: "M-1" } }))
        expect([opened.status, fits("loan.open", 201, opened.text)]).toEqual([201, null])
        expect(bodyOf(opened.text)).toMatchObject({ isbn: "978-1", memberId: "M-1", title: "Rivers", name: "Reader One", state: "open" })
        const loans = await service.call(ACCOUNT, callOf("member.loan.list", { memberId: "M-1" }))
        expect(bodyOf(loans.text)).toMatchObject({ items: [{ isbn: "978-1", title: "Rivers" }] })
        expect((await service.call(ACCOUNT, callOf("member.loan.list", { memberId: "M-9" }))).status).toBe(404)
        const stats = await service.call(ACCOUNT, callOf("stat.get"))
        expect([bodyOf(stats.text), fits("stat.get", 200, stats.text)]).toEqual([{ books: 2, loans: 1, label: "" }, null])
    })

    it("answers EVERY operation of the document with no declaration at all: no operation is a gap (an empty store; 404 for an unknown item)", async () => {
        const { service } = setup({})
        for (const operation of DOCUMENT.operations.values()) {
            const input = { isbn: "x", memberId: "x", body: { title: "T", isbn: "I-1", memberId: "M" } }
            const answer = await service.call(ACCOUNT, callOf(operation.operationId, input))
            expect([operation.operationId, fits(operation.operationId, answer.status, answer.text)]).toEqual([operation.operationId, null])
        }
    })

    it("keeps each account's store apart; generated keys are deterministic per account and collection", async () => {
        const { service } = setup()
        const one = bodyOf((await service.call(ACCOUNT, callOf("book.add", { body: { title: "A" } }))).text)
        expect((await service.call(OTHER, callOf("book.get", { isbn: (one as { isbn: string }).isbn }))).status).toBe(404)
        const again = setup()
        expect(bodyOf((await again.service.call(ACCOUNT, callOf("book.add", { body: { title: "A" } }))).text)).toEqual(one)
    })

    it("refuses a connector no package pins a readable document for, and an operation its document does not serve, naming the gap", async () => {
        const { sandbox } = sandboxServiceOf(ACCOUNT)
        const empty = new OpenApiSandboxReachService(sandbox, new OpenApiSandboxFixturesRegistryService())
        await expect(empty.call(ACCOUNT, callOf("book.list"))).rejects.toMatchObject({ code: ProviderSandboxErrorCode.CaseUnknown, params: { caseId: "crm.lib:book.list" } })
        const { service } = setup()
        await expect(service.call(ACCOUNT, { ...callOf("book.list"), operationId: "book.burn" })).rejects.toMatchObject({
            code: ProviderSandboxErrorCode.CaseUnknown,
            params: { caseId: "crm.lib:book.burn" },
        })
    })
})

describe("OpenApiSandboxReachService: the replay key (an operation whose document declares it)", () => {
    it("answers a repeated key with the kept result and acts once; another request under the key is refused 409; after OPENAPI-4 the same key finds the applied act", async () => {
        const { service, sandbox } = setup()
        const first = await service.call(ACCOUNT, callOf("book.add", { "Idempotency-Key": "nivo:k1", body: { title: "Once" } }))
        const again = await service.call(ACCOUNT, callOf("book.add", { "Idempotency-Key": "nivo:k1", body: { title: "Once" } }))
        expect(again).toEqual(first)
        expect(bodyOf((await service.call(ACCOUNT, callOf("book.list"))).text)).toMatchObject({ items: [{ isbn: "978-1" }, { isbn: "978-2" }, { title: "Once" }] })
        const reused = await service.call(ACCOUNT, callOf("book.add", { "Idempotency-Key": "nivo:k1", body: { title: "Other" } }))
        expect([reused.status, bodyOf(reused.text), fits("book.add", 409, reused.text)]).toEqual([409, expect.objectContaining({ code: "idempotency_key_reused" }), null])
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.timedOut)
        expect((await service.call(ACCOUNT, callOf("book.add", { "Idempotency-Key": "nivo:k2", body: { title: "Lost" } }))).status).toBe(504)
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.answered)
        const settled = await service.call(ACCOUNT, callOf("book.add", { "Idempotency-Key": "nivo:k2", body: { title: "Lost" } }))
        expect([settled.status, bodyOf(settled.text)]).toEqual([201, expect.objectContaining({ title: "Lost" })])
        const titles = (bodyOf((await service.call(ACCOUNT, callOf("book.list"))).text) as { items: ReadonlyArray<{ title: string }> }).items.map((one) => one.title)
        expect(titles.filter((title) => title === "Lost")).toHaveLength(1)
    })

    it("acts every time for an operation whose document declares no replay key", async () => {
        const { service } = setup()
        await service.call(ACCOUNT, callOf("loan.open", { "Idempotency-Key": "nivo:k1", body: { isbn: "978-1", memberId: "M-1" } }))
        await service.call(ACCOUNT, callOf("loan.open", { "Idempotency-Key": "nivo:k1", body: { isbn: "978-1", memberId: "M-1" } }))
        expect(bodyOf((await service.call(ACCOUNT, callOf("member.loan.list", { memberId: "M-1" }))).text)).toMatchObject({ items: [{}, {}] })
    })
})

describe("OpenApiSandboxReachService: the cases", () => {
    it("OPENAPI-2: the package's own refusal, else a 422 in the document's shape; nothing applied; sticky until the default is picked again", async () => {
        const { service, sandbox } = setup()
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.refused)
        const own = await service.call(ACCOUNT, callOf("book.add", { body: { isbn: "978-9", title: "X" } }))
        expect([own.status, bodyOf(own.text)]).toEqual([409, { code: "book_exists" }])
        const plain = await service.call(ACCOUNT, callOf("book.hold", { isbn: "978-1" }))
        expect([plain.status, bodyOf(plain.text), fits("book.hold", 422, plain.text)]).toEqual([422, expect.objectContaining({ code: "refused" }), null])
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.answered)
        expect((await service.call(ACCOUNT, callOf("book.get", { isbn: "978-9" }))).status).toBe(404)
        expect(bodyOf((await service.call(ACCOUNT, callOf("book.get", { isbn: "978-1" }))).text)).toMatchObject({ onHold: false })
    })

    it("OPENAPI-3: a 503 in the document's shape, nothing kept", async () => {
        const { service, sandbox } = setup()
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.failed)
        const failed = await service.call(ACCOUNT, callOf("book.add", { body: { isbn: "978-8", title: "Y" } }))
        expect([failed.status, fits("book.add", 503, failed.text)]).toEqual([503, null])
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.answered)
        expect((await service.call(ACCOUNT, callOf("book.get", { isbn: "978-8" }))).status).toBe(404)
    })

    it("OPENAPI-4: the write is applied but its answer is lost (504); a later read sees it", async () => {
        const { service, sandbox } = setup()
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.timedOut)
        expect((await service.call(ACCOUNT, callOf("book.add", { body: { isbn: "978-7", title: "Z" } }))).status).toBe(504)
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.answered)
        expect(bodyOf((await service.call(ACCOUNT, callOf("book.get", { isbn: "978-7" }))).text)).toMatchObject({ title: "Z" })
    })

    it("OPENAPI-5: the request is lost before it applied: a timeout thrown (the connector reads it as unknown), nothing kept", async () => {
        const { service, sandbox } = setup()
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.lost)
        await expect(service.call(ACCOUNT, callOf("book.add", { body: { isbn: "978-6", title: "W" } }))).rejects.toMatchObject({ name: "TimeoutError" })
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.answered)
        expect((await service.call(ACCOUNT, callOf("book.get", { isbn: "978-6" }))).status).toBe(404)
    })

    it("OPENAPI-6: the store's answer after the slow pause", async () => {
        jest.useFakeTimers()
        try {
            const { service, sandbox } = setup()
            await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.slow)
            let done = false
            const answer = service.call(ACCOUNT, callOf("book.get", { isbn: "978-1" })).then((one) => {
                done = true
                return one
            })
            await jest.advanceTimersByTimeAsync(OPENAPI_SANDBOX_SLOW_MS - 1)
            expect(done).toBe(false)
            await jest.advanceTimersByTimeAsync(1)
            expect((await answer).status).toBe(200)
        } finally {
            jest.useRealTimers()
        }
    })

    it("a case picked for ONE operation (its operation id as the scope) wins over the pick of every call; other operations keep theirs", async () => {
        const { service, sandbox } = setup()
        await sandbox.setNextCase(ACCOUNT, "book.hold", OPENAPI_SANDBOX_CASE.refused)
        expect((await service.call(ACCOUNT, callOf("book.hold", { isbn: "978-1" }))).status).toBe(422)
        expect((await service.call(ACCOUNT, callOf("book.get", { isbn: "978-1" }))).status).toBe(200)
        await sandbox.setNextCase(ACCOUNT, OPENAPI_CALL_OPERATION, OPENAPI_SANDBOX_CASE.failed)
        expect((await service.call(ACCOUNT, callOf("book.get", { isbn: "978-1" }))).status).toBe(503)
        expect((await service.call(ACCOUNT, callOf("book.hold", { isbn: "978-1" }))).status).toBe(422)
    })

    it("logs ONE call per request under its operation id, with the request", async () => {
        const { service, sandbox } = setup()
        await service.call(ACCOUNT, callOf("book.list", { genre: "novel" }))
        await service.call(ACCOUNT, callOf("book.get", { isbn: "x" }))
        expect((await sandbox.calls(ACCOUNT)).map((one) => one.operation)).toEqual(["book.list", "book.get"])
        expect((await sandbox.calls(ACCOUNT, "book.list"))[0]?.request).toMatchObject({ connector: "crm.lib", operationId: "book.list", input: { genre: "novel" } })
    })

    it("reaches no host, holds no secret and reads no live document", async () => {
        const { service } = setup()
        await expect(service.reachable(ACCOUNT, AUTH)).resolves.toBeUndefined()
        await expect(service.keyOf(ACCOUNT, AUTH)).resolves.toEqual({ type: "bearer", name: "", value: OPENAPI_SANDBOX_KEY_VALUE })
        await expect(service.liveDocument(ACCOUNT, "https://lib.example.test/openapi.json")).resolves.toBeNull()
    })

    it("refuses a live account on every member", async () => {
        const { service } = setup()
        const refused = { code: ProviderSandboxErrorCode.LiveAccount }
        await expect(service.call(LIVE, callOf("book.list"))).rejects.toMatchObject(refused)
        await expect(service.reachable(LIVE, AUTH)).rejects.toMatchObject(refused)
        await expect(service.keyOf(LIVE, AUTH)).rejects.toMatchObject(refused)
        await expect(service.liveDocument(LIVE, "u")).rejects.toMatchObject(refused)
    })

    it("refuses everything with the switch off", async () => {
        const { sandbox } = sandboxServiceOff(ACCOUNT)
        const service = new OpenApiSandboxReachService(sandbox, registryOf())
        await expect(service.call(ACCOUNT, callOf("book.list"))).rejects.toMatchObject({ code: ProviderSandboxErrorCode.Off })
        await expect(service.keyOf(ACCOUNT, AUTH)).rejects.toMatchObject({ code: ProviderSandboxErrorCode.Off })
    })

    it("has a catalogue of OPENAPI-<n> ids, unique, each with an outcome, exactly one default of `call`", () => {
        const ids = OPENAPI_SANDBOX_CATALOGUE.cases.map((one) => one.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^OPENAPI-\d+$/u.test(id))).toBe(true)
        expect(OPENAPI_SANDBOX_CATALOGUE.cases.every((one) => one.outcome !== undefined)).toBe(true)
        expect(OPENAPI_SANDBOX_CATALOGUE.cases.filter((one) => one.default === true).map((one) => one.operation)).toEqual([OPENAPI_CALL_OPERATION])
    })

    it("calls no network: no integration client in its source, only the sandbox frame and the fixtures", () => {
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toMatch(/\bhttp\b/iu)
        expect(OpenApiSandboxReachService.length).toBe(2)
    })
})
