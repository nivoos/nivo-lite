import type { ProviderSandboxAnswer, ProviderSandboxOperation } from "@nivo-lite/agent-sdk/installation"
import { CRM_NIVOWEB } from "./api.generated"

/*
 * The starting data and the acts of NIVO Web's CRM on a NIVO Sandbox account. The engine's OpenAPI sandbox is a stateful store per
 * sandbox account, derived from the pinned document (`openapi.json`, base path `/v1`): a collection is the first path segment, its key
 * member the parameter of its item path. This file only DECLARES (in the SDK's `ProviderSandboxOperation` shape, keyed by the
 * operation's one name):
 *   - the STARTING RECORDS: one list operation per seeded collection with `listsBack: { collection, listField: "items" }`, whose
 *     `items` are the records the account starts with;
 *   - WHAT AN ACT SETS: on an item or create operation, `keeps` + a `body` of the members the act sets that the request does not carry
 *     (the request body is laid over it);
 *   - the FAULT ANSWERS of the writes the nodes call: `refused` (a realistic CRM code) and `failed` (503 `unavailable`).
 * Every member is the document's member name and type. All data is invented: no real person, phone or mail (`.test` domains,
 * 09xxxxxxx numbers like 0900000001). Days are fixed: they count from `SANDBOX_TODAY`, never from a clock.
 *
 * Human names of the records whose key is a uuid (the document has no reference member for them):
 *   renewals:  RQ-NWC-01 = a1d4c2e6-...-8c01 (SV-NWC-01, GHNWC01)   RQ-NWC-02 = ...-8c02 (SV-NWC-02, GHNWC02)   RQ-NWC-03 = ...-8c03 (SV-NWC-07, GHNWC03)
 *   purchases: PU-NWC-01 = b2e5d3f7-...-9d01   PU-NWC-02 = ...-9d02   PU-NWC-03 = ...-9d03   (their `code` member carries the human name)
 *   tickets:   T-NWC-01 (open fault) = c3e5a7b9-...-8d6e-0f1a2b3c4d01   T-NWC-02 (waiting_customer) = ...-4d02
 */

const DAY_MS = 86_400_000

/**
 * The one reference day of the starting data: the day its facts (`daysLeft`, `lastReminderOn`, `quotedOn`, ...) are true of. A catalogue
 * never reads a clock (provider-sandbox rule 11): every date below is computed from this constant, so the data is identical on every
 * machine and every day.
 */
export const SANDBOX_TODAY = "2026-11-16"

/** The day `days` from the reference day (negative: before), `YYYY-MM-DD`; pure arithmetic on the constant. */
const day = (days: number): string => new Date(Date.parse(SANDBOX_TODAY) + days * DAY_MS).toISOString().slice(0, 10)
/** A moment on the day `days` from the reference day, ISO date-time (03:00 UTC, 10:00 in Vietnam). */
const at = (days: number): string => `${day(days)}T03:00:00.000Z`

/** The 4xx / 5xx answers in the error shape of the document (`ErrorResponse`). */
const refusal = (status: number, code: string, message: string): ProviderSandboxAnswer => ({ status, body: { code, message } })
const FAILED: ProviderSandboxAnswer = { status: 503, body: { code: "unavailable", message: "the CRM is not answering" } }

const contact = (name: string, preferredChannel: "zalo" | "email" | "phone", phone: string | null, email: string | null, zaloId: string | null) => ({
    name,
    preferredChannel,
    phone,
    email,
    zaloId,
})

/* ---------------------------------------------------------------- customers (key `code`) */

const CUSTOMERS = [
    {
        code: "KH-NWC-01",
        kind: "company",
        name: "Công ty NWC Một",
        taxId: "0100000001",
        phone: "0900000001",
        email: "lienhe@nwc-01.test",
        address: "1 Đường Thử Nghiệm, Quận 1, TP.HCM",
        folderPath: null,
        reachable: true,
        domains: ["nwc-01.vn"],
        contacts: [contact("Chị Lan NWC", "zalo", "0900000001", "lan@nwc-01.test", "zalo-nwc-01")],
    },
    {
        code: "KH-NWC-02",
        kind: "company",
        name: "Công ty NWC Hai",
        taxId: "0100000002",
        phone: null,
        email: "lienhe@nwc-02.test",
        address: "2 Đường Thử Nghiệm, Quận 3, TP.HCM",
        folderPath: null,
        reachable: true,
        domains: ["nwc-02.vn", "nwc-04.vn"],
        contacts: [contact("Anh Hai NWC", "email", null, "hai@nwc-02.test", null)],
    },
    {
        code: "KH-NWC-03",
        kind: "person",
        name: "Cửa hàng NWC Ba",
        taxId: null,
        phone: null,
        email: null,
        address: null,
        folderPath: null,
        reachable: false,
        domains: ["nwc-03.vn"],
        contacts: [],
    },
]

/* ---------------------------------------------------------------- services (key `code`) */

/** The renewal requests' ids (see the table above). */
const RQ_01 = "a1d4c2e6-7b3f-4a58-9c1e-0d2f4b6a8c01"
const RQ_02 = "a1d4c2e6-7b3f-4a58-9c1e-0d2f4b6a8c02"
const RQ_03 = "a1d4c2e6-7b3f-4a58-9c1e-0d2f4b6a8c03"

interface ServiceRow {
    readonly code: string
    readonly customerCode: string
    readonly domain: string | null
    readonly serviceClass: "hosting" | "domain" | "ssl"
    readonly provider: string | null
    readonly daysLeft: number
    readonly reachable: boolean
    readonly expirySource?: "provider" | "estimated"
    readonly reminder?: { readonly daysAgo: number; readonly count: number; readonly open: boolean }
    readonly openRenewalId?: string
}

const serviceOf = (row: ServiceRow) => ({
    code: row.code,
    customerCode: row.customerCode,
    domain: row.domain,
    serviceClass: row.serviceClass,
    provider: row.provider,
    status: row.daysLeft < 0 ? "expired" : "active",
    statusText: row.daysLeft < 0 ? "Hết hạn" : "Đang hoạt động",
    startsOn: day(row.daysLeft - 365),
    expiresOn: day(row.daysLeft),
    expirySource: row.expirySource ?? "provider",
    daysLeft: row.daysLeft,
    reachable: row.reachable,
    lastReminderOn: row.reminder === undefined ? null : day(-row.reminder.daysAgo),
    reminderCount: row.reminder?.count ?? 0,
    openReminder: row.reminder?.open ?? false,
    openRenewalId: row.openRenewalId ?? null,
})

const SERVICES = [
    { code: "SV-NWC-01", customerCode: "KH-NWC-01", domain: "nwc-01.vn", serviceClass: "domain", provider: "inet", daysLeft: 10, reachable: true, openRenewalId: RQ_01 },
    { code: "SV-NWC-02", customerCode: "KH-NWC-01", domain: "nwc-01.vn", serviceClass: "hosting", provider: "tino", daysLeft: 12, reachable: true, openRenewalId: RQ_02 },
    { code: "SV-NWC-03", customerCode: "KH-NWC-01", domain: "nwc-03.vn", serviceClass: "domain", provider: "azwebsite", daysLeft: 15, reachable: true, expirySource: "estimated" },
    { code: "SV-NWC-04", customerCode: "KH-NWC-02", domain: "nwc-04.vn", serviceClass: "domain", provider: "inet", daysLeft: 200, reachable: true },
    { code: "SV-NWC-05", customerCode: "KH-NWC-02", domain: "nwc-02.vn", serviceClass: "domain", provider: "inet", daysLeft: 5, reachable: true },
    { code: "SV-NWC-06", customerCode: "KH-NWC-01", domain: "nwc-01.vn", serviceClass: "ssl", provider: null, daysLeft: -12, reachable: true },
    {
        code: "SV-NWC-07",
        customerCode: "KH-NWC-02",
        domain: "nwc-02.vn",
        serviceClass: "hosting",
        provider: "tino",
        daysLeft: 20,
        reachable: true,
        reminder: { daysAgo: 6, count: 1, open: false },
        openRenewalId: RQ_03,
    },
    {
        code: "SV-NWC-08",
        customerCode: "KH-NWC-01",
        domain: "nwc-01.vn",
        serviceClass: "ssl",
        provider: null,
        daysLeft: 28,
        reachable: true,
        reminder: { daysAgo: 4, count: 1, open: true },
    },
    { code: "SV-NWC-09", customerCode: "KH-NWC-03", domain: "nwc-03.vn", serviceClass: "hosting", provider: "tino", daysLeft: 9, reachable: false },
].map((row) => serviceOf(row as ServiceRow))

/* ---------------------------------------------------------------- renewals (key `id`, uuid) */

interface RenewalRow {
    readonly id: string
    readonly serviceCode: string
    readonly customerCode: string
    readonly provider: string
    readonly termMonths: number
    readonly netVnd: number
    readonly vatVnd: number
    readonly paymentCode: string
}

const renewalOf = (row: RenewalRow) => ({
    ...row,
    state: "awaiting_payment",
    totalVnd: row.netVnd + row.vatVnd,
    priceSource: "price_sheet",
    transactionRef: null,
    paidAt: null,
    providerRef: null,
    newExpiresOn: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: at(-1),
})

/** RQ-NWC-01 and RQ-NWC-02 have the SAME total on purpose: only the payment code tells them apart. */
const RENEWALS = [
    { id: RQ_01, serviceCode: "SV-NWC-01", customerCode: "KH-NWC-01", provider: "inet", termMonths: 12, netVnd: 1_100_000, vatVnd: 88_000, paymentCode: "GHNWC01" },
    { id: RQ_02, serviceCode: "SV-NWC-02", customerCode: "KH-NWC-01", provider: "tino", termMonths: 12, netVnd: 1_100_000, vatVnd: 88_000, paymentCode: "GHNWC02" },
    { id: RQ_03, serviceCode: "SV-NWC-07", customerCode: "KH-NWC-02", provider: "tino", termMonths: 24, netVnd: 2_200_000, vatVnd: 176_000, paymentCode: "GHNWC03" },
].map(renewalOf)

/* ---------------------------------------------------------------- purchases (key `id`, uuid) */

const PU_01 = "b2e5d3f7-8c4a-4b69-9d01-1e3a5c7e9b01"
const PU_02 = "b2e5d3f7-8c4a-4b69-9d01-1e3a5c7e9b02"
const PU_03 = "b2e5d3f7-8c4a-4b69-9d01-1e3a5c7e9b03"

/** A one-line quote: the CRM computes the lines, the VAT and the total; here they are written out. */
const quoteOf = (priceCode: string, name: string, termMonths: number | null, netVnd: number, quotedDaysAgo: number) => {
    const vatVnd = Math.round(netVnd / 10)
    return {
        lines: [{ priceCode, name, termMonths, quantity: 1, unitPriceVnd: netVnd, amountVnd: netVnd }],
        netVnd,
        vatRatePercent: 10,
        vatVnd,
        totalVnd: netVnd + vatVnd,
        priceSource: "price_sheet",
        quotedOn: day(-quotedDaysAgo),
        validUntil: day(14 - quotedDaysAgo),
    }
}

const PURCHASES = [
    {
        id: PU_01,
        code: "PU-NWC-01",
        state: "awaiting_payment",
        channel: "zalo",
        sourceRef: "nwc-conv-pu01",
        need: "Thiết kế website giới thiệu công ty NWC Một.",
        contactName: "Chị Lan NWC",
        phone: "0900000001",
        email: "lan@nwc-01.test",
        domain: "nwc-01.vn",
        customerCode: "KH-NWC-01",
        quote: quoteOf("WEBSITE-STANDARD", "Website chuẩn", null, 5_000_000, 5),
        paymentCode: "MUANWC01",
        transactionRef: null,
        paidAt: null,
        acceptedAt: at(-3),
        projectCode: "PRJ-NWC-01",
        contractNo: "HD-NWC-01",
        note: null,
        followUps: [],
        quotedOn: day(-5),
        validUntil: day(9),
        lastFollowUpOn: null,
        followUpCount: 0,
        openFollowUp: false,
        reachable: true,
    },
    {
        id: PU_02,
        code: "PU-NWC-02",
        state: "quoted",
        channel: "zalo",
        sourceRef: "nwc-conv-pu02",
        need: "Đăng ký tên miền nwc-shop.vn.",
        contactName: "Anh Ba NWC",
        phone: "0900000002",
        email: "ba@nwc-shop.test",
        domain: "nwc-shop.vn",
        customerCode: null,
        quote: quoteOf("DOMAIN-VN-12", "Tên miền .vn 12 tháng", 12, 450_000, 2),
        paymentCode: null,
        transactionRef: null,
        paidAt: null,
        acceptedAt: null,
        projectCode: null,
        contractNo: null,
        note: null,
        followUps: [],
        quotedOn: day(-2),
        validUntil: day(12),
        lastFollowUpOn: null,
        followUpCount: 0,
        openFollowUp: false,
        reachable: true,
    },
    {
        id: PU_03,
        code: "PU-NWC-03",
        state: "quoted",
        channel: "email",
        sourceRef: "nwc-mail-pu03",
        need: "Hosting cho website của NWC Hai.",
        contactName: "Anh Hai NWC",
        phone: null,
        email: "hai@nwc-02.test",
        domain: "nwc-02.vn",
        customerCode: "KH-NWC-02",
        quote: quoteOf("HOSTING-STARTER-12", "Hosting Starter 12 tháng", 12, 1_200_000, 8),
        paymentCode: null,
        transactionRef: null,
        paidAt: null,
        acceptedAt: null,
        projectCode: null,
        contractNo: null,
        note: null,
        followUps: [{ day: day(-4), channel: "email", outcome: "sent", messageRef: "nwc-mail-out-04" }],
        quotedOn: day(-8),
        validUntil: day(6),
        lastFollowUpOn: day(-4),
        followUpCount: 1,
        openFollowUp: true,
        reachable: true,
    },
]

/* ---------------------------------------------------------------- tickets (key `id`, uuid) */

const T_01 = "c3e5a7b9-1d2f-4b4c-8d6e-0f1a2b3c4d01"
const T_02 = "c3e5a7b9-1d2f-4b4c-8d6e-0f1a2b3c4d02"

const TICKETS = [
    {
        id: T_01,
        customerCode: "KH-NWC-01",
        kind: "fault",
        status: "open",
        channel: "zalo",
        subject: "Website nwc-01.vn không truy cập được",
        summary: "Khách báo trang nwc-01.vn báo lỗi 503 từ sáng nay.",
        serviceCodes: ["SV-NWC-02"],
        sourceRef: "nwc-conv-t01",
        openedAt: at(-1),
        closedAt: null,
        notes: [],
    },
    {
        id: T_02,
        customerCode: "KH-NWC-02",
        kind: "question",
        status: "waiting_customer",
        channel: "email",
        subject: "Hỏi cách trỏ tên miền về hosting",
        summary: "Khách hỏi cách trỏ nwc-02.vn về hosting mới.",
        serviceCodes: ["SV-NWC-05"],
        sourceRef: "nwc-mail-t02",
        openedAt: at(-3),
        closedAt: null,
        notes: [
            {
                id: "d4f6b8ca-2e3a-4c5d-9e7f-1a2b3c4d5e01",
                author: "NIVO Web",
                body: "Đã gửi hướng dẫn trỏ DNS, đang chờ khách xác nhận.",
                createdAt: at(-2),
                statusFrom: "open",
                statusTo: "waiting_customer",
            },
        ],
    },
]

/* ---------------------------------------------------------------- invoices, contracts, documents */

const INVOICES = [
    { customerCode: "KH-NWC-01", invoiceNo: "C26TNW/00000101", issuedOn: day(-90), amountVnd: 5_500_000, hasDocument: true },
    { customerCode: "KH-NWC-01", invoiceNo: "C26TNW/00000102", issuedOn: day(-40), amountVnd: 1_188_000, hasDocument: true },
    { customerCode: "KH-NWC-01", invoiceNo: "C26TNW/00000103", issuedOn: day(-10), amountVnd: 495_000, hasDocument: false },
    { customerCode: "KH-NWC-02", invoiceNo: "C26TNW/00000104", issuedOn: day(-20), amountVnd: 1_320_000, hasDocument: true },
]

const CONTRACTS = [
    {
        customerCode: "KH-NWC-01",
        contractNo: "HD-NWC-01",
        kind: "website",
        partnerName: "Công ty NWC Một",
        signedOn: day(-100),
        effectiveOn: day(-100),
        expiresOn: null,
        warrantyUntil: day(265),
        autoRenew: false,
        valueVnd: 11_000_000,
        statusText: "Đang thực hiện",
    },
    {
        customerCode: "KH-NWC-01",
        contractNo: "HD-NWC-02",
        kind: "hosting",
        partnerName: "Công ty NWC Một",
        signedOn: day(-355),
        effectiveOn: day(-355),
        expiresOn: day(10),
        warrantyUntil: null,
        autoRenew: true,
        valueVnd: 1_188_000,
        statusText: "Còn hiệu lực",
    },
    {
        customerCode: "KH-NWC-02",
        contractNo: "HD-NWC-03",
        kind: "domain",
        partnerName: "Công ty NWC Hai",
        signedOn: day(-165),
        effectiveOn: day(-165),
        expiresOn: day(200),
        warrantyUntil: null,
        autoRenew: false,
        valueVnd: 495_000,
        statusText: "Còn hiệu lực",
    },
]

const DOCUMENTS = [
    { customerCode: "KH-NWC-01", fileName: "HD-NWC-01.pdf", kind: "contract", path: "KH-NWC-01/hop-dong/HD-NWC-01.pdf", contractNo: "HD-NWC-01", invoiceNo: null, sizeBytes: 182_400 },
    { customerCode: "KH-NWC-01", fileName: "HD-NWC-02.pdf", kind: "contract", path: "KH-NWC-01/hop-dong/HD-NWC-02.pdf", contractNo: "HD-NWC-02", invoiceNo: null, sizeBytes: 150_200 },
    { customerCode: "KH-NWC-01", fileName: "C26TNW-00000101.pdf", kind: "invoice", path: "KH-NWC-01/hoa-don/C26TNW-00000101.pdf", contractNo: null, invoiceNo: "C26TNW/00000101", sizeBytes: 64_000 },
    { customerCode: "KH-NWC-02", fileName: "HD-NWC-03.pdf", kind: "contract", path: "KH-NWC-02/hop-dong/HD-NWC-03.pdf", contractNo: "HD-NWC-03", invoiceNo: null, sizeBytes: 120_800 },
]

/* ---------------------------------------------------------------- receivables (key `code` = the project code), payables, prices */

const RECEIVABLES = [
    {
        code: "PRJ-NWC-01",
        projectCode: "PRJ-NWC-01",
        customerCode: "KH-NWC-01",
        contractRef: "HD-NWC-01",
        projectState: "in_progress",
        totalVnd: 11_000_000,
        collectedVnd: 5_500_000,
        remainingVnd: 5_500_000,
        dueOn: day(-20),
        lastNoticeOn: null,
        noticeCount: 0,
        paymentCount: 1,
    },
    {
        code: "PRJ-NWC-02",
        projectCode: "PRJ-NWC-02",
        customerCode: "KH-NWC-02",
        contractRef: "HD-NWC-03",
        projectState: "in_progress",
        totalVnd: 3_300_000,
        collectedVnd: 0,
        remainingVnd: 3_300_000,
        dueOn: day(-7),
        lastNoticeOn: day(-2),
        noticeCount: 1,
        paymentCount: 0,
    },
]

const PAYABLES = [
    { partyCode: "SUP-NWC-01", partyName: "Nhà cung cấp NWC Một", closingCreditVnd: 8_800_000, closingDebitVnd: 0, noteCount: 0, lastNoteInvoiceNo: null },
    { partyCode: "SUP-NWC-02", partyName: "Nhà cung cấp NWC Hai", closingCreditVnd: 2_200_000, closingDebitVnd: 0, noteCount: 1, lastNoteInvoiceNo: "NCC/0000201" },
]

const PRICES = [
    {
        priceCode: "HOSTING-STARTER-12",
        name: "Hosting Starter 12 tháng",
        kind: "new",
        serviceClass: "hosting",
        termMonths: 12,
        setupVnd: 0,
        netVnd: 1_200_000,
        vatRatePercent: 10,
        vatVnd: 120_000,
        totalVnd: 1_320_000,
        instalmentPercents: [],
        priceSource: "placeholder",
    },
    {
        priceCode: "DOMAIN-VN-12",
        name: "Tên miền .vn 12 tháng",
        kind: "new",
        serviceClass: "domain",
        termMonths: 12,
        setupVnd: 0,
        netVnd: 450_000,
        vatRatePercent: 10,
        vatVnd: 45_000,
        totalVnd: 495_000,
        instalmentPercents: [],
        priceSource: "price_sheet",
    },
    {
        priceCode: "SSL-BASIC-12",
        name: "Chứng chỉ SSL cơ bản 12 tháng",
        kind: "new",
        serviceClass: "ssl",
        termMonths: 12,
        setupVnd: 0,
        netVnd: 600_000,
        vatRatePercent: 10,
        vatVnd: 60_000,
        totalVnd: 660_000,
        instalmentPercents: [],
        priceSource: "price_sheet",
    },
    {
        priceCode: "WEBSITE-STANDARD",
        name: "Website chuẩn",
        kind: "new",
        serviceClass: "website",
        termMonths: null,
        setupVnd: 0,
        netVnd: 5_000_000,
        vatRatePercent: 10,
        vatVnd: 500_000,
        totalVnd: 5_500_000,
        instalmentPercents: [50, 50],
        priceSource: "price_sheet",
    },
]

/** One starting record: the members are the document's member names (the store keys it by its collection's key member). */
export type SandboxRecord = Readonly<Record<string, unknown>>

/** The starting records by seeded collection (the collections the document's list operations name). */
export interface NivowebSeed {
    readonly customers: ReadonlyArray<SandboxRecord>
    readonly services: ReadonlyArray<SandboxRecord>
    readonly renewals: ReadonlyArray<SandboxRecord>
    readonly purchases: ReadonlyArray<SandboxRecord>
    readonly tickets: ReadonlyArray<SandboxRecord>
    readonly invoices: ReadonlyArray<SandboxRecord>
    readonly contracts: ReadonlyArray<SandboxRecord>
    readonly documents: ReadonlyArray<SandboxRecord>
    readonly receivables: ReadonlyArray<SandboxRecord>
    readonly payables: ReadonlyArray<SandboxRecord>
    readonly prices: ReadonlyArray<SandboxRecord>
}

/**
 * The records each seeded collection starts with, by collection (the engine's store keys them by the key member of the document's item
 * path). Exported for the package's own checks.
 */
export const NIVOWEB_SEED: NivowebSeed = {
    customers: CUSTOMERS,
    services: SERVICES,
    renewals: RENEWALS,
    purchases: PURCHASES,
    tickets: TICKETS,
    invoices: INVOICES,
    contracts: CONTRACTS,
    documents: DOCUMENTS,
    receivables: RECEIVABLES,
    payables: PAYABLES,
    prices: PRICES,
}

/** The key member of each seeded collection (the parameter of the document's item path). */
export const NIVOWEB_SEED_KEYS: Readonly<Record<string, string | null>> = {
    customers: "code",
    services: "code",
    renewals: "id",
    purchases: "id",
    tickets: "id",
    invoices: null,
    contracts: null,
    documents: null,
    receivables: "code",
    payables: "partyCode",
    prices: null,
}

/** A list operation that starts a collection with its records: a page of them, the last one. */
const starts = (collection: string, items: ReadonlyArray<unknown>): ProviderSandboxOperation => ({
    status: 200,
    body: { items, nextCursor: null },
    listsBack: { collection, listField: "items" },
})

/** A write that the store remembers: the members it sets, the record it acts on or creates, its fault answers. */
const acts = (
    status: number,
    body: Readonly<Record<string, unknown>>,
    collection: string,
    keyField: string,
    refused: ProviderSandboxAnswer,
    reuses?: NonNullable<ProviderSandboxOperation["keeps"]>["reuses"],
): ProviderSandboxOperation => ({ status, body, keeps: { collection, keyField, ...(reuses === undefined ? {} : { reuses }) }, refused, failed: FAILED })

/**
 * The NIVO Sandbox's answers of this CRM, by operation. Not declared on purpose (the engine's generic default answers them):
 * `post_renewals_id_outcome` and `post_purchases_id_outcome` (the request's `outcome` word maps to a `state`, which a laid-over body
 * cannot express), `post_receivables_code_payments`, the other reads of one record (`get_*_id`, the customers' sub-lists, the
 * summary counts) which the store answers from the records above.
 */
export const NIVOWEB_SANDBOX: Readonly<Record<string, ProviderSandboxOperation>> = {
    // The starting records.
    [CRM_NIVOWEB.get_customers]: starts("customers", CUSTOMERS),
    [CRM_NIVOWEB.get_services_expiring]: starts("services", SERVICES),
    [CRM_NIVOWEB.get_renewals_open]: starts("renewals", RENEWALS),
    [CRM_NIVOWEB.get_purchases_open]: starts("purchases", PURCHASES),
    [CRM_NIVOWEB.get_tickets]: starts("tickets", TICKETS),
    [CRM_NIVOWEB.get_invoices]: starts("invoices", INVOICES),
    [CRM_NIVOWEB.get_contracts]: starts("contracts", CONTRACTS),
    [CRM_NIVOWEB.get_receivables_overdue]: starts("receivables", RECEIVABLES),
    [CRM_NIVOWEB.get_payables]: starts("payables", PAYABLES),
    [CRM_NIVOWEB.get_prices]: {
        ...starts("prices", PRICES),
        refused: refusal(404, "CRM_PRICE_NOT_FOUND", "no such price"),
        failed: FAILED,
    },
    [CRM_NIVOWEB.get_customers_code_documents]: starts("documents", DOCUMENTS),

    // Customers. A created customer is KH-NWC-90 (one per run); a contact link has no state of its own (the answer is a fixed one).
    [CRM_NIVOWEB.post_customers]: acts(
        201,
        {
            code: "KH-NWC-90",
            customerCode: "KH-NWC-90",
            reachable: true,
            folderPath: null,
            domains: [],
            contacts: [],
            address: null,
            email: null,
            phone: null,
            taxId: null,
        },
        "customers",
        "code",
        refusal(409, "CRM_CUSTOMER_EXISTS", "a customer with this tax id, phone or mail exists"),
    ),
    [CRM_NIVOWEB.post_customers_code_contacts]: {
        status: 200,
        body: {
            customerCode: "KH-NWC-01",
            created: true,
            contact: contact("Liên hệ mới NWC", "zalo", null, null, "zalo-nwc-new"),
        },
        refused: refusal(404, "CRM_CUSTOMER_NOT_FOUND", "no customer with this code"),
        failed: FAILED,
    },

    // Services: a reminder marks the service.
    [CRM_NIVOWEB.post_services_code_reminders]: acts(
        201,
        { id: "e5a7c9db-3f4b-4d6e-8f8a-2b3c4d5e6f01", sentAt: at(0), lastReminderOn: day(0), openReminder: true },
        "services",
        "code",
        refusal(404, "CRM_SERVICE_NOT_FOUND", "no service with this code"),
    ),

    // Renewals: a created request awaits payment under a fixed payment code and total; paying it marks it paid.
    [CRM_NIVOWEB.post_renewals]: acts(
        201,
        {
            state: "awaiting_payment",
            termMonths: 12,
            netVnd: 1_100_000,
            vatVnd: 88_000,
            totalVnd: 1_188_000,
            priceSource: "price_sheet",
            paymentCode: "GHNWC90",
            transactionRef: null,
            paidAt: null,
            providerRef: null,
            newExpiresOn: null,
            confirmedBy: null,
            confirmedAt: null,
            createdAt: at(0),
        },
        "renewals",
        "id",
        refusal(409, "CRM_RENEWAL_OPEN_EXISTS", "the service already has an open renewal request"),
    ),
    [CRM_NIVOWEB.post_renewals_id_payments]: acts(
        200,
        { state: "paid", paidAt: at(0) },
        "renewals",
        "id",
        refusal(409, "CRM_TRANSACTION_USED", "this bank transaction already proved another payment"),
    ),

    // Invoice drafts: the lines are one fixed line, the amounts come from the renewal the draft names; issuing marks it issued.
    [CRM_NIVOWEB.post_invoice_drafts]: acts(
        200,
        {
            state: "draft",
            lines: [{ description: "Gia hạn dịch vụ", quantity: 1, unitPriceVnd: 1_100_000, amountVnd: 1_100_000 }],
            invoiceNo: null,
            providerRef: null,
            issuedOn: null,
            purchaseId: null,
            vatRatePercent: 8,
        },
        "invoice-drafts",
        "id",
        refusal(422, "CRM_INVOICE_DRAFT_SUBJECT_INVALID", "an invoice draft names a renewal or a purchase, not both"),
    ),
    [CRM_NIVOWEB.post_invoice_drafts_id_invoice]: acts(
        200,
        { state: "issued" },
        "invoice-drafts",
        "id",
        refusal(409, "CRM_INVOICE_ALREADY_ISSUED", "the draft already records another issued invoice"),
    ),

    // Purchases: created as an enquiry (PU-NWC-90); a quote is one fixed line; acceptance awaits payment; payment marks it paid.
    [CRM_NIVOWEB.post_purchases]: acts(
        201,
        {
            code: "PU-NWC-90",
            state: "enquiry",
            customerCode: null,
            contactName: null,
            phone: null,
            email: null,
            domain: null,
            quote: null,
            paymentCode: null,
            transactionRef: null,
            paidAt: null,
            acceptedAt: null,
            projectCode: null,
            contractNo: null,
            note: null,
            followUps: [],
            quotedOn: null,
            validUntil: null,
            lastFollowUpOn: null,
            followUpCount: 0,
            openFollowUp: false,
            reachable: true,
        },
        "purchases",
        "id",
        refusal(404, "CRM_CUSTOMER_NOT_FOUND", "no customer with this code"),
        // The CRM answers the OPEN purchase of the same channel and source instead of opening another (an enquiry's talk calls this every round).
        { by: ["channel", "sourceRef"], whileIn: { field: "state", values: ["enquiry", "quoted", "awaiting_payment", "paid", "pending_person"] } },
    ),
    [CRM_NIVOWEB.patch_purchases_id]: acts(200, {}, "purchases", "id", refusal(409, "CRM_PURCHASE_STATE_REFUSED", "the purchase's state does not allow this")),
    [CRM_NIVOWEB.post_purchases_id_quotes]: acts(
        201,
        {
            state: "quoted",
            quote: quoteOf("DOMAIN-VN-12", "Tên miền .vn 12 tháng", 12, 450_000, 0),
            quotedOn: day(0),
            validUntil: day(14),
        },
        "purchases",
        "id",
        refusal(409, "CRM_PRICE_PLACEHOLDER", "a quote names a placeholder price row"),
    ),
    [CRM_NIVOWEB.post_purchases_id_followups]: acts(
        200,
        { lastFollowUpOn: day(0), openFollowUp: true },
        "purchases",
        "id",
        refusal(409, "CRM_PURCHASE_STATE_REFUSED", "the purchase's state does not allow this"),
    ),
    [CRM_NIVOWEB.post_purchases_id_acceptance]: acts(
        200,
        {
            state: "awaiting_payment",
            acceptedAt: at(0),
            paymentCode: "MUANWC90",
            contractNo: "HD-NWC-90",
            projectCode: "PRJ-NWC-90",
            serviceCodes: [],
            firstInstalmentVnd: 2_750_000,
            dryRun: false,
        },
        "purchases",
        "id",
        refusal(409, "CRM_PURCHASE_STATE_REFUSED", "the purchase's state does not allow this"),
    ),
    [CRM_NIVOWEB.post_purchases_id_payments]: acts(
        200,
        { state: "paid", paidAt: at(0) },
        "purchases",
        "id",
        refusal(409, "CRM_TRANSACTION_REF_USED", "this bank transaction already proved another renewal or purchase"),
    ),

    // Tickets: created open; an update lays the request (status, note, author) over the ticket.
    [CRM_NIVOWEB.post_tickets]: acts(
        201,
        { status: "open", openedAt: at(0), closedAt: null, notes: [], serviceCodes: [] },
        "tickets",
        "id",
        refusal(422, "CRM_TICKET_SERVICE_UNKNOWN", "a ticket names a service code the workspace does not have"),
    ),
    [CRM_NIVOWEB.patch_tickets_id]: acts(
        200,
        {},
        "tickets",
        "id",
        refusal(409, "CRM_TICKET_TRANSITION_REFUSED", "the ticket's status does not allow this change"),
    ),

    // Receivables and payables: a notice and a note mark the record.
    [CRM_NIVOWEB.post_receivables_code_notices]: acts(
        201,
        { id: "f6b8dae0-4a5c-4e7f-9a9b-3c4d5e6f7a01", sentAt: at(0), lastNoticeOn: day(0) },
        "receivables",
        "code",
        refusal(404, "CRM_RECEIVABLE_NOT_FOUND", "no receivable with this project code"),
    ),
    [CRM_NIVOWEB.post_payables_party_code_notes]: acts(
        201,
        { id: "07c9ebf1-5b6d-4f80-8bac-4d5e6f7a8b01", recordedAt: at(0) },
        "payables",
        "partyCode",
        refusal(404, "CRM_PAYABLE_NOT_FOUND", "no TK331 balance with this party code"),
    ),
}
