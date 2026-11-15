import { crmTools, crmAnswer } from "../../vocabulary/crm-tools"
import { CRM_NIVOWEB } from "./api.generated"
import { NIVOWEB_SANDBOX, NIVOWEB_SEED, NIVOWEB_SEED_KEYS } from "./sandbox"
import { NIVOWEB_CRM } from "./template"

/*
 * The starting data of NIVO Web's CRM on a NIVO Sandbox account: every record parses with the item schema of the CRM tool that lists
 * it, keys are valid and unique, the template loads, and the names the matrix fixes exist.
 */

type Row = Readonly<Record<string, unknown>>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The tool whose answer lists each seeded collection (the operation that declares its starting records). */
const LISTING_TOOL: Readonly<Record<string, string>> = {
    customers: CRM_NIVOWEB.get_customers,
    services: CRM_NIVOWEB.get_services_expiring,
    renewals: CRM_NIVOWEB.get_renewals_open,
    purchases: CRM_NIVOWEB.get_purchases_open,
    tickets: CRM_NIVOWEB.get_tickets,
    invoices: CRM_NIVOWEB.get_invoices,
    contracts: CRM_NIVOWEB.get_contracts,
    receivables: CRM_NIVOWEB.get_receivables_overdue,
    payables: CRM_NIVOWEB.get_payables,
    prices: CRM_NIVOWEB.get_prices,
    documents: CRM_NIVOWEB.get_customers_code_documents,
}

const rows = (collection: string): ReadonlyArray<Row> => NIVOWEB_SEED[collection as keyof typeof NIVOWEB_SEED] as ReadonlyArray<Row>
const keyOf = (collection: string): string | null => NIVOWEB_SEED_KEYS[collection] ?? null

describe("NIVO Web CRM sandbox data", () => {
    it("declares one starting-records operation per seeded collection", () => {
        for (const [collection, op] of Object.entries(LISTING_TOOL)) {
            const declared = NIVOWEB_SANDBOX[op]
            expect(declared?.listsBack).toEqual({ collection, listField: "items" })
            expect((declared?.body as { items: unknown[] }).items).toBe(rows(collection))
        }
    })

    it("parses every seeded record with the result schema of its CRM tool", () => {
        for (const [collection, op] of Object.entries(LISTING_TOOL)) {
            const tool = crmTools.find((candidate) => candidate.id === op)
            expect(tool).toBeDefined()
            const parsed = tool?.result.safeParse(crmAnswer({ items: rows(collection), nextCursor: null }))
            expect({ collection, ok: parsed?.success, issues: parsed?.success === false ? parsed.error.issues.slice(0, 3) : [] }).toEqual({
                collection,
                ok: true,
                issues: [],
            })
        }
    })

    it("parses the customers with the one-customer result schema (contacts, domains)", () => {
        const tool = crmTools.find((candidate) => candidate.id === CRM_NIVOWEB.get_customers_code)
        for (const customer of rows("customers")) {
            expect(tool?.result.safeParse(crmAnswer(customer)).success).toBe(true)
        }
    })

    it("parses the purchases and tickets with their one-record result schemas", () => {
        const purchase = crmTools.find((candidate) => candidate.id === CRM_NIVOWEB.get_purchases_id)
        for (const row of rows("purchases")) expect(purchase?.result.safeParse(crmAnswer(row)).success).toBe(true)
        const ticket = crmTools.find((candidate) => candidate.id === CRM_NIVOWEB.get_tickets_id)
        for (const row of rows("tickets")) expect(ticket?.result.safeParse(crmAnswer(row)).success).toBe(true)
    })

    it("keys every uuid-keyed collection by a valid uuid", () => {
        for (const collection of ["renewals", "purchases", "tickets"]) {
            for (const row of rows(collection)) expect(String(row["id"])).toMatch(UUID)
        }
        for (const row of rows("services")) {
            if (row["openRenewalId"] !== null) expect(String(row["openRenewalId"])).toMatch(UUID)
        }
        for (const row of rows("tickets")) {
            for (const note of row["notes"] as ReadonlyArray<Row>) expect(String(note["id"])).toMatch(UUID)
        }
    })

    it("keeps keys unique per collection and every reference to a customer or a service whole", () => {
        for (const collection of Object.keys(LISTING_TOOL)) {
            const key = keyOf(collection)
            if (key === null) continue
            const keys = rows(collection).map((row) => String(row[key]))
            expect(new Set(keys).size).toBe(keys.length)
        }
        const customers = new Set(rows("customers").map((row) => String(row["code"])))
        const services = new Set(rows("services").map((row) => String(row["code"])))
        for (const collection of ["services", "renewals", "tickets", "invoices", "contracts", "documents", "receivables"]) {
            for (const row of rows(collection)) {
                if (row["customerCode"] !== null) expect(customers).toContain(String(row["customerCode"]))
            }
        }
        for (const row of rows("renewals")) expect(services).toContain(String(row["serviceCode"]))
        const renewals = new Set(rows("renewals").map((row) => String(row["id"])))
        for (const row of rows("services")) {
            if (row["openRenewalId"] !== null) expect(renewals).toContain(String(row["openRenewalId"]))
        }
    })

    it("lets the template load with the sandbox declared", () => {
        expect(NIVOWEB_CRM.id).toBe("nivoweb")
        expect(NIVOWEB_CRM.sandbox).toBe(NIVOWEB_SANDBOX)
    })

    it("gives the writes a refusal (4xx) and a failure (5xx)", () => {
        for (const op of [
            CRM_NIVOWEB.post_tickets,
            CRM_NIVOWEB.patch_tickets_id,
            CRM_NIVOWEB.post_renewals,
            CRM_NIVOWEB.post_renewals_id_payments,
            CRM_NIVOWEB.post_purchases_id_acceptance,
            CRM_NIVOWEB.post_invoice_drafts_id_invoice,
        ]) {
            const declared = NIVOWEB_SANDBOX[op]
            expect(declared?.refused?.status).toBeGreaterThanOrEqual(400)
            expect(declared?.refused?.status).toBeLessThan(500)
            expect(declared?.failed?.status).toBe(503)
            expect(declared?.keeps).toBeDefined()
        }
    })

    it("has every name the matrix fixes (section 2.4)", () => {
        const by = (collection: string, key: string, value: string): Row | undefined => rows(collection).find((row) => row[key] === value)
        expect(by("customers", "code", "KH-NWC-01")).toMatchObject({ name: "Công ty NWC Một", reachable: true })
        expect((by("customers", "code", "KH-NWC-01")?.["contacts"] as ReadonlyArray<Row>)[0]).toMatchObject({ preferredChannel: "zalo" })
        expect(by("customers", "code", "KH-NWC-02")).toBeDefined()
        expect(by("customers", "code", "KH-NWC-03")).toMatchObject({ reachable: false })
        expect(by("services", "code", "SV-NWC-01")).toMatchObject({ domain: "nwc-01.vn", provider: "inet", daysLeft: 10 })
        expect(by("services", "code", "SV-NWC-02")).toMatchObject({ serviceClass: "hosting", provider: "tino", daysLeft: 12 })
        expect(by("services", "code", "SV-NWC-03")).toMatchObject({ serviceClass: "domain", provider: "azwebsite" })
        expect(by("services", "code", "SV-NWC-04")).toMatchObject({ serviceClass: "domain", daysLeft: 200 })
        expect(rows("services").some((row) => row["daysLeft"] as number < 0)).toBe(true)
        expect(rows("services").some((row) => row["openReminder"] === true)).toBe(true)
        expect(rows("services").some((row) => row["serviceClass"] === "ssl")).toBe(true)
        const rq = (paymentCode: string): Row | undefined => by("renewals", "paymentCode", paymentCode)
        expect(rq("GHNWC01")).toMatchObject({ serviceCode: "SV-NWC-01", totalVnd: 1_188_000, state: "awaiting_payment" })
        expect(rq("GHNWC02")).toMatchObject({ serviceCode: "SV-NWC-02", totalVnd: 1_188_000, state: "awaiting_payment" })
        expect(rq("GHNWC03")).toMatchObject({ totalVnd: 2_376_000, state: "awaiting_payment" })
        expect(by("purchases", "code", "PU-NWC-01")).toMatchObject({
            customerCode: "KH-NWC-01",
            paymentCode: "MUANWC01",
            quote: { totalVnd: 5_500_000 },
        })
        expect(by("purchases", "code", "PU-NWC-02")).toMatchObject({ customerCode: null, state: "quoted" })
        expect(by("purchases", "code", "PU-NWC-03")).toMatchObject({ state: "quoted", openFollowUp: true })
        expect(by("receivables", "projectCode", "PRJ-NWC-01")).toMatchObject({ customerCode: "KH-NWC-01" })
        expect(by("payables", "partyCode", "SUP-NWC-01")).toBeDefined()
        expect(rows("tickets").map((row) => row["status"])).toEqual(expect.arrayContaining(["open", "waiting_customer"]))
        expect(rows("invoices").some((row) => row["customerCode"] === "KH-NWC-01")).toBe(true)
        expect(rows("contracts").some((row) => row["customerCode"] === "KH-NWC-01")).toBe(true)
        expect(rows("documents").some((row) => row["customerCode"] === "KH-NWC-01")).toBe(true)
        expect(by("prices", "priceCode", "HOSTING-STARTER-12")).toMatchObject({ totalVnd: 1_320_000 })
        expect(rows("prices").some((row) => row["serviceClass"] === "domain" && row["termMonths"] === 12)).toBe(true)
        expect(rows("prices").some((row) => row["serviceClass"] === "ssl")).toBe(true)
    })
})
