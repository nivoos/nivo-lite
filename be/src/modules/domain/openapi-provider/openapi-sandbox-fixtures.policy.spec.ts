import type { ProviderTemplate } from "@nivo-lite/agent-sdk/installation"
import { CRM_TEMPLATES } from "@modules/domain/openapi-tools"
import { sandboxFixturesOf } from "./openapi-sandbox-fixtures.policy"

/** A small document: a price page read, a ticket write (the request's body is laid over the fixture), a read with no JSON answer. */
const DOCUMENT = {
    openapi: "3.1.0",
    info: { title: "Sample CRM", version: "1" },
    paths: {
        "/prices": {
            get: {
                operationId: "price.list",
                responses: {
                    "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/PricePage" } } } },
                    default: { content: { "application/json": { schema: { $ref: "#/components/schemas/Failure" } } } },
                },
            },
        },
        "/tickets": {
            post: {
                responses: {
                    "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
                    "4XX": { content: { "application/json": { schema: { $ref: "#/components/schemas/Failure" } } } },
                    "5XX": { content: { "application/json": { schema: { $ref: "#/components/schemas/Failure" } } } },
                },
            },
        },
        "/ping": { get: { responses: { "204": { description: "" } } } },
    },
    components: {
        schemas: {
            PricePage: {
                type: "object",
                required: ["items", "nextCursor"],
                properties: {
                    items: { type: "array", items: { type: "object", required: ["code"], properties: { code: { type: "string" } } } },
                    nextCursor: { type: "string", nullable: true },
                },
            },
            Ticket: { type: "object", required: ["id", "subject"], properties: { id: { type: "string" }, subject: { type: "string" } } },
            Failure: { type: "object", required: ["code"], properties: { code: { type: "string" } } },
        },
    },
}

const PRICES = "nivo.api.crm.sample.get.prices"
const TICKETS = "nivo.api.crm.sample.post.tickets"

const templateOf = (sandbox: ProviderTemplate["sandbox"]): ProviderTemplate => ({
    kind: "crm",
    id: "sample",
    label: { vi: "CRM mau", en: "Sample CRM" },
    openapi: DOCUMENT,
    swaggerPath: "/openapi.json",
    auth: { type: "bearer" },
    baseUrlHint: "https://crm.example.test",
    sandbox,
})

describe("sandboxFixturesOf", () => {
    it("keys the fixtures by the document's operation id (the operation's name when the document gives none) under the connector", () => {
        const sandbox = {
            [PRICES]: { status: 200, body: { items: [{ code: "P1" }], nextCursor: null }, refused: { status: 404, body: { code: "gone" } } },
            [TICKETS]: { status: 201, body: { id: "T-1", subject: "x" }, failed: { status: 503, body: { code: "down" } } },
        }
        const reading = sandboxFixturesOf(templateOf(sandbox))
        expect(reading.problems).toEqual([])
        expect(reading.fixtures.connector).toBe("crm.sample")
        expect(Object.keys(reading.fixtures.operations).toSorted()).toEqual([TICKETS, "price.list"])
        expect(reading.fixtures.operations["price.list"]).toBe(sandbox[PRICES])
    })

    it("names an answer that does not fit the response schema of its status: the default and the refusal (the failure fits)", () => {
        const reading = sandboxFixturesOf(
            templateOf({
                [PRICES]: {
                    status: 200,
                    body: { items: [{ code: 7 }], nextCursor: null },
                    refused: { status: 404, body: { message: "no code" } },
                    failed: { status: 503, body: { code: "down" } },
                },
            }),
        )
        expect(reading.problems).toEqual([`${PRICES} OPENAPI-1: items[0].code: type`, `${PRICES} OPENAPI-2: code: required`])
    })

    it("names an operation the document does not serve and a status it does not declare; a class schema judges its statuses", () => {
        const reading = sandboxFixturesOf(
            templateOf({
                "nivo.api.crm.sample.get.orders": { status: 200, body: {} },
                [TICKETS]: { status: 201, body: { id: "T-1", subject: "x" }, refused: { status: 409, body: { code: "dup" } } },
                "nivo.api.crm.sample.get.ping": { status: 200, body: {} },
            }),
        )
        expect(reading.problems).toEqual([
            "nivo.api.crm.sample.get.orders: not an operation of the pinned document",
            "nivo.api.crm.sample.get.ping OPENAPI-1: status 200 is not declared by the document",
        ])
        expect(Object.keys(reading.fixtures.operations)).toContain(TICKETS)
    })

    it("does not judge the default answer of a write that keeps (the call's body is laid over it), but its refusal", () => {
        const kept = { collection: "tickets", keyField: "id" }
        const open = sandboxFixturesOf(templateOf({ [TICKETS]: { status: 201, body: { subject: "only" }, keeps: kept } }))
        expect(open.problems).toEqual([])
        const refused = sandboxFixturesOf(
            templateOf({ [TICKETS]: { status: 201, body: {}, keeps: kept, refused: { status: 422, body: {} } } }),
        )
        expect(refused.problems).toEqual([`${TICKETS} OPENAPI-2: code: required`])
    })

    it("answers no operation for a template without the member, and names a document it cannot read", () => {
        expect(sandboxFixturesOf(templateOf(undefined)).fixtures.operations).toEqual({})
        const unreadable = sandboxFixturesOf({ ...templateOf({}), openapi: { swagger: "2.0", paths: {} } })
        expect(unreadable.problems).toEqual(["document: swagger_2"])
    })
})

describe("the installed packages' sandbox fixtures", () => {
    it("every CRM template's fixtures fit the document it pins (the package check)", () => {
        for (const template of CRM_TEMPLATES) expect([template.id, sandboxFixturesOf(template).problems]).toEqual([template.id, []])
    })
})
