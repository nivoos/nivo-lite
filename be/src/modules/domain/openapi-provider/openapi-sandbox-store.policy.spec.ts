import { CRM_TEMPLATES, responseSchemaOf, violationOf, type PinnedOperation } from "@modules/domain/openapi-tools"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import type { OpenApiReachAccount, OpenApiReachCall } from "./openapi-reach.contracts"
import { OpenApiSandboxFixturesRegistryService } from "./openapi-sandbox-fixtures-registry.service"
import { sandboxFixturesOf } from "./openapi-sandbox-fixtures.policy"
import { OpenApiSandboxReachService } from "./openapi-sandbox-reach.service"
import { filteredOf, generatedKeyOf, keyMembersOf, resourceOf, segmentsOf, shapedOf } from "./openapi-sandbox-store.policy"

/*
 * THE GATE (fixing rule 9) of "a sandbox account answers every operation of its pinned document": on every installed CRM template (the
 * case: nivo-web-core's CRM, read through the installation the app runs), every operation of the document is answered in a shape the
 * document declares, never `PROVIDER_SANDBOX_CASE_UNKNOWN`; an item operation answers 2xx once its collection holds the record. The second
 * kind (a document that is no CRM) is proven in `openapi-sandbox-reach.service.spec.ts`.
 */

const callOf = (operation: PinnedOperation, input: Readonly<Record<string, unknown>>): OpenApiReachCall => ({
    baseUrl: "https://crm.example.test/v1",
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    params: [],
    hasBody: input["body"] !== undefined,
    input,
    key: null,
    maxBytes: 100_000,
})

/** The answer judged against the schema its status declares; a line naming the misfit, or null. */
const misfitOf = (operation: PinnedOperation, status: number, text: string): string | null => {
    const schema = responseSchemaOf(operation, status)
    if (schema === undefined) return `${operation.operationId}: status ${String(status)} not declared`
    const problem = schema === null ? null : violationOf(schema, JSON.parse(text))
    return problem === null ? null : `${operation.operationId} ${String(status)}: ${problem}`
}

describe("the generic store on every installed CRM document (the case)", () => {
    for (const template of CRM_TEMPLATES) {
        it(`crm.${template.id}: every operation answers in a declared shape, and every item operation answers 2xx on a record its collection holds`, async () => {
            const account: OpenApiReachAccount = { ...sandboxAccount({ id: `conn-${template.id}`, provider: "openapi" }), connector: `crm.${template.id}` }
            const registry = new OpenApiSandboxFixturesRegistryService()
            const { fixtures } = sandboxFixturesOf(template)
            registry.register(fixtures)
            const { sandbox } = sandboxServiceOf(account)
            const service = new OpenApiSandboxReachService(sandbox, registry)
            const document = fixtures.document
            expect(document).not.toBeNull()
            if (document === null) return
            const operations = [...document.operations.values()]
            const keys = keyMembersOf(document)
            const problems: Array<string> = []
            const keyOf = new Map<string, string>()
            // Pass 1: every operation, with a body shaped from its own schema and an unknown key: a declared shape (a 404 is the system's own).
            for (const operation of operations) {
                const body = operation.body === null ? undefined : shapedOf(operation.body.schema, {})
                const params = Object.fromEntries(operation.parameters.map((parameter) => [parameter.name, "sbx-unknown"]))
                const answer = await service.call(account, callOf(operation, { ...params, ...(body === undefined ? {} : { body }) }))
                const misfit = misfitOf(operation, answer.status, answer.text)
                if (misfit !== null) problems.push(misfit)
                const [collection, second] = segmentsOf(operation.path, document.source.basePath)
                const member = collection === undefined ? undefined : keys.get(collection.text)
                if (operation.method === "POST" && second === undefined && collection !== undefined && member !== undefined && answer.status < 300) {
                    const made: unknown = JSON.parse(answer.text)
                    const key = typeof made === "object" && made !== null ? (made as Record<string, unknown>)[member] : undefined
                    if (typeof key === "string") keyOf.set(collection.text, key)
                }
            }
            expect(problems).toEqual([])
            // Pass 2: every item operation of a collection that now holds a record answers 2xx in its declared shape.
            for (const operation of operations) {
                const [collection, second] = segmentsOf(operation.path, document.source.basePath)
                const key = collection === undefined ? undefined : keyOf.get(collection.text)
                if (second?.param !== true || key === undefined || operation.method === "DELETE") continue
                const body = operation.body === null ? undefined : shapedOf(operation.body.schema, {})
                const answer = await service.call(account, callOf(operation, { [second.text]: key, ...(body === undefined ? {} : { body }) }))
                expect([operation.operationId, answer.status < 300, misfitOf(operation, answer.status, answer.text)]).toEqual([operation.operationId, true, null])
            }
        })
    }
})

describe("openapi-sandbox-store.policy", () => {
    it("reads segments below the base path and the kind of an operation from its method and path", () => {
        expect(segmentsOf("/v1/renewals/{id}/payments", "/v1")).toEqual([
            { param: false, text: "renewals" },
            { param: true, text: "id" },
            { param: false, text: "payments" },
        ])
        const op = (method: PinnedOperation["method"], path: string, list = false): PinnedOperation =>
            ({
                method,
                path,
                responses: { "200": list ? { type: "object", properties: { items: { type: "array" } } } : { type: "object", properties: { n: { type: "integer" } } } },
            }) as unknown as PinnedOperation
        expect(resourceOf(op("POST", "/v1/a"), "/v1", undefined)).toEqual({ kind: "create", collection: "a" })
        expect(resourceOf(op("GET", "/v1/a/open", true), "/v1", undefined)).toEqual({ kind: "list", collection: "a" })
        expect(resourceOf(op("GET", "/v1/a/counts"), "/v1", undefined)).toEqual({ kind: "summary", collection: "a" })
        expect(resourceOf(op("GET", "/v1/a/{k}"), "/v1", undefined)).toEqual({ kind: "read", collection: "a", keyParam: "k" })
        expect(resourceOf(op("PATCH", "/v1/a/{k}"), "/v1", undefined)).toEqual({ kind: "update", collection: "a", keyParam: "k" })
        expect(resourceOf(op("POST", "/v1/a/{k}/act"), "/v1", undefined)).toEqual({ kind: "update", collection: "a", keyParam: "k" })
        expect(resourceOf(op("GET", "/v1/a/{k}/b", true), "/v1", undefined)).toEqual({ kind: "children", collection: "a", keyParam: "k", child: "b" })
        expect(resourceOf(op("GET", "/v1/a/{k}/status"), "/v1", undefined)).toEqual({ kind: "project", collection: "a", keyParam: "k" })
        expect(resourceOf(op("GET", "/v1/a/{k}/status"), "/v1", { status: 200, body: { n: 1 } })).toEqual({ kind: "fixed" })
    })

    it("shapes a value to a schema: keeps what fits, defaults what is required and missing, drops what is not declared", () => {
        const schema = {
            type: "object",
            required: ["id", "state", "total", "note", "tags"],
            properties: {
                id: { type: "string" },
                state: { type: "string", enum: ["draft", "issued"] },
                total: { type: "integer", minimum: 0 },
                note: { type: "string", nullable: true },
                tags: { type: "array", items: { type: "string" } },
                optional: { type: "string" },
            },
            additionalProperties: false,
        }
        expect(shapedOf(schema, { id: "A", extra: 1, total: "x" })).toEqual({ id: "A", state: "draft", total: 0, note: null, tags: [] })
    })

    it("filters by parameters that are members only; generated keys are uuid-shaped and deterministic", () => {
        const rows = [{ a: "1", b: "x" }, { a: "2", b: "y" }]
        expect(filteredOf(rows, { a: "2", limit: 10 })).toEqual([{ a: "2", b: "y" }])
        expect(filteredOf(rows, { a: "2" }, ["a"])).toEqual(rows)
        expect(generatedKeyOf("acc", "c", 1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
        expect(generatedKeyOf("acc", "c", 1)).toBe(generatedKeyOf("acc", "c", 1))
        expect(generatedKeyOf("acc", "c", 2)).not.toBe(generatedKeyOf("acc", "c", 1))
    })
})
