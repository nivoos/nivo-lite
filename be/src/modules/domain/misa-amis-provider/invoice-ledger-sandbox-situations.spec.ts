import type { BusinessLedgerEntry } from "@modules/domain/provider-registry"
import { proofOf, providerRefusalDetail, providerRefusalReason, ProviderRegistryErrorCode } from "@modules/domain/provider-registry"
import { GoogleSandboxLedgerService } from "@modules/domain/google-connections/google-sandbox-ledger.service"
import { GOOGLE_LEDGER_CASE } from "@modules/domain/google-connections/google-sandbox.catalogue"
import { MisaMeinvoiceSandboxInvoiceService } from "@modules/domain/misa-meinvoice-provider/misa-meinvoice-sandbox-invoice.service"
import { MISA_MEINVOICE_SANDBOX_CATALOGUE, MISA_SANDBOX_CASE } from "@modules/domain/misa-meinvoice-provider/misa-meinvoice-sandbox.catalogue"
import { MISA_MEINVOICE_SANDBOX_COVERAGE } from "@modules/domain/misa-meinvoice-provider/misa-meinvoice-sandbox.coverage"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { MisaAmisSandboxLedgerService } from "./misa-amis-sandbox-ledger.service"
import { AMIS_SANDBOX_CASE, AMIS_SANDBOX_CATALOGUE } from "./misa-amis-sandbox.catalogue"
import { MISA_AMIS_SANDBOX_COVERAGE } from "./misa-amis-sandbox.coverage"

/*
 * THE SANDBOX STANDARD for the two MISA providers (meInvoice: the e-invoice issue port; AMIS: the ledger port), whose live twins have no
 * operation built (docs-missing), so every shape is the generic port shape. One table of situations, two providers (the second kind of
 * each: meInvoice vs AMIS for the act outcomes and the unknown-applied read; AMIS vs the Google ledger for the refused connection).
 */

const entry = (transactionId: string): BusinessLedgerEntry => ({
    date: "2026-11-14",
    orderNo: "DH-001",
    customer: "Dinh",
    amountVnd: 250_000,
    transactionId,
    status: "paid",
    note: "",
})

const failureOf = async (work: Promise<unknown>): Promise<unknown> => {
    try {
        await work
    } catch (cause) {
        return cause
    }
    throw new Error("expected a failure")
}

const amis = () => {
    const account = sandboxAccount({ provider: "misa_amis" })
    const { sandbox } = sandboxServiceOf(account)
    const connection = connectionRecord({ provider: "misa_amis", id: account.id, workspaceId: account.workspaceId, sandbox: true })
    return { account, sandbox, connection, ledger: new MisaAmisSandboxLedgerService(sandbox) }
}

const meinvoice = () => {
    const account = sandboxAccount({ provider: "misa_meinvoice" })
    const { sandbox } = sandboxServiceOf(account)
    const connection = connectionRecord({ provider: "misa_meinvoice", id: account.id, workspaceId: account.workspaceId, sandbox: true })
    return { account, sandbox, connection, service: new MisaMeinvoiceSandboxInvoiceService(sandbox) }
}

/** The case id of the first case of an outcome in a list of cases: the one the outcome picker takes. */
const firstOf = (cases: ReadonlyArray<{ readonly id: string; readonly operation?: string | undefined; readonly outcome?: string | undefined }>, operation: string, outcome: string): string | undefined =>
    cases.find((one) => one.operation === operation && one.outcome === outcome)?.id

describe("meInvoice issue: every outcome of the act, by tag", () => {
    it("the first case of each tag is the plain one: ok MISA-1, refused MISA-2, timeout MISA-3 (nothing issued), transient MISA-4 (not sent)", () => {
        const cases = MISA_MEINVOICE_SANDBOX_CATALOGUE.cases
        expect(firstOf(cases, "issue", "ok")).toBe(MISA_SANDBOX_CASE.issued)
        expect(firstOf(cases, "issue", "refused")).toBe(MISA_SANDBOX_CASE.rejected)
        expect(firstOf(cases, "issue", "timeout")).toBe(MISA_SANDBOX_CASE.noAnswer)
        expect(firstOf(cases, "issue", "transient")).toBe(MISA_SANDBOX_CASE.unavailable)
        expect(cases.some((one) => one.outcome === "final")).toBe(false)
        expect(MISA_MEINVOICE_SANDBOX_COVERAGE.roles.find((role) => role.operation === "issue")?.covers["act.final"]).toMatchObject({ na: expect.any(String) })
    })

    it("MISA-4 transient: a failure before anything is issued (not_sent), no number consumed; the next issue takes number 1", async () => {
        const ctx = meinvoice()
        await ctx.sandbox.setNextCase(ctx.account, "issue", MISA_SANDBOX_CASE.unavailable)
        const failure = await failureOf(ctx.service.issue(ctx.connection, { draftId: "d-1", renewalId: null }))
        expect(proofOf(failure)).toBe("not_sent")
        await ctx.sandbox.setNextCase(ctx.account, "issue", MISA_SANDBOX_CASE.issued)
        expect((await ctx.service.issue(ctx.connection, { draftId: "d-1", renewalId: null })).invoiceNo).toBe("C26TSB/00000001")
    })

    it("MISA-3 (nothing issued, unknown) and MISA-6 (issued, unknown) both fail unknown; only MISA-6 consumes the number (act.unknown_applied)", async () => {
        const lost = meinvoice()
        await lost.sandbox.setNextCase(lost.account, "issue", MISA_SANDBOX_CASE.noAnswer)
        expect(proofOf(await failureOf(lost.service.issue(lost.connection, { draftId: "d-1", renewalId: null })))).toBe("unknown")
        await lost.sandbox.setNextCase(lost.account, "issue", MISA_SANDBOX_CASE.issued)
        expect((await lost.service.issue(lost.connection, { draftId: "d-2", renewalId: null })).invoiceNo).toBe("C26TSB/00000001")

        const applied = meinvoice()
        await applied.sandbox.setNextCase(applied.account, "issue", MISA_SANDBOX_CASE.timeoutApplied)
        expect(proofOf(await failureOf(applied.service.issue(applied.connection, { draftId: "d-1", renewalId: null })))).toBe("unknown")
        await applied.sandbox.setNextCase(applied.account, "issue", MISA_SANDBOX_CASE.issued)
        expect((await applied.service.issue(applied.connection, { draftId: "d-2", renewalId: null })).invoiceNo).toBe("C26TSB/00000002")
    })

    it("MISA-7: an invoice accepted but not numbered (state pending, invoiceNo null, no issue date), no number consumed", async () => {
        const ctx = meinvoice()
        await ctx.sandbox.setNextCase(ctx.account, "issue", MISA_SANDBOX_CASE.notNumbered)
        const first = await ctx.service.issue(ctx.connection, { draftId: "d-1", renewalId: null })
        expect(first).toEqual({ id: "sbx-inv-pending-000001", state: "pending", invoiceNo: null, issuedOn: null })
        await ctx.sandbox.setNextCase(ctx.account, "issue", MISA_SANDBOX_CASE.issued)
        expect(await ctx.service.issue(ctx.connection, { draftId: "d-1", renewalId: null })).toMatchObject({ id: "sbx-inv-00000001", state: "issued", invoiceNo: "C26TSB/00000001" })
    })

    it("MISA-5 is sticky: every issue is refused auth_refused (not sent) until another case is picked (connection.credential_refused / .revoked)", async () => {
        const ctx = meinvoice()
        await ctx.sandbox.setNextCase(ctx.account, "issue", MISA_SANDBOX_CASE.authRefused)
        for (let round = 0; round < 2; round += 1) {
            const failure = await failureOf(ctx.service.issue(ctx.connection, { draftId: "d-1", renewalId: null }))
            expect(providerRefusalReason(failure)).toBe("auth_refused")
            expect(proofOf(failure)).toBe("not_sent")
        }
    })
})

describe("AMIS ledger: the same act outcomes as meInvoice (the second kind), and the ledger's own", () => {
    it("the first case of each tag: append ok -2, refused -3, timeout -4 (nothing kept), transient -8; void ok -5, refused -6, timeout -12, transient -13", () => {
        const cases = AMIS_SANDBOX_CATALOGUE.cases
        expect([
            firstOf(cases, "append", "ok"),
            firstOf(cases, "append", "refused"),
            firstOf(cases, "append", "timeout"),
            firstOf(cases, "append", "transient"),
            firstOf(cases, "void", "ok"),
            firstOf(cases, "void", "refused"),
            firstOf(cases, "void", "timeout"),
            firstOf(cases, "void", "transient"),
        ]).toEqual(["MISA-AMIS-2", "MISA-AMIS-3", "MISA-AMIS-4", "MISA-AMIS-8", "MISA-AMIS-5", "MISA-AMIS-6", "MISA-AMIS-12", "MISA-AMIS-13"])
        expect(cases.some((one) => one.outcome === "final")).toBe(false)
        for (const operation of ["append", "void"]) {
            expect(MISA_AMIS_SANDBOX_COVERAGE.roles.find((role) => role.operation === operation)?.covers["act.final"]).toMatchObject({ na: expect.any(String) })
        }
    })

    it("MISA-AMIS-8 append transient: not sent, nothing kept (a void of it is then refused not_found)", async () => {
        const ctx = amis()
        await ctx.sandbox.setNextCase(ctx.account, "append", AMIS_SANDBOX_CASE.appendTransient)
        expect(proofOf(await failureOf(ctx.ledger.append(ctx.connection, entry("TX-1"))))).toBe("not_sent")
        expect(providerRefusalReason(await failureOf(ctx.ledger.void(ctx.connection, "TX-1")))).toBe("not_found")
    })

    it("MISA-AMIS-9 append applied then lost: fails unknown, the voucher EXISTS (the void of it now books), like meInvoice's MISA-6 (act.unknown_applied)", async () => {
        const ctx = amis()
        await ctx.sandbox.setNextCase(ctx.account, "append", AMIS_SANDBOX_CASE.appendAppliedLost)
        expect(proofOf(await failureOf(ctx.ledger.append(ctx.connection, entry("TX-1"))))).toBe("unknown")
        await expect(ctx.ledger.void(ctx.connection, "TX-1")).resolves.toBe("SBX-AMIS-VOID-000001")
    })

    it("MISA-AMIS-4 append no answer: fails unknown and keeps NOTHING (a void of it is refused not_found): the not-done half of the unknown outcome", async () => {
        const ctx = amis()
        await ctx.sandbox.setNextCase(ctx.account, "append", AMIS_SANDBOX_CASE.appendNoAnswer)
        expect(proofOf(await failureOf(ctx.ledger.append(ctx.connection, entry("TX-1"))))).toBe("unknown")
        expect(providerRefusalReason(await failureOf(ctx.ledger.void(ctx.connection, "TX-1")))).toBe("not_found")
    })

    it("void: -10 not_found whatever the state, -12 no answer, -13 not now, -14 added then lost", async () => {
        const ctx = amis()
        await ctx.ledger.append(ctx.connection, entry("TX-1"))

        await ctx.sandbox.setNextCase(ctx.account, "void", AMIS_SANDBOX_CASE.voidNotFound)
        const missing = await failureOf(ctx.ledger.void(ctx.connection, "TX-1"))
        expect(providerRefusalReason(missing)).toBe("not_found")
        expect(proofOf(missing)).toBe("not_sent")
        expect(providerRefusalDetail(missing)).toBe("voucher")

        await ctx.sandbox.setNextCase(ctx.account, "void", AMIS_SANDBOX_CASE.voidNoAnswer)
        expect(proofOf(await failureOf(ctx.ledger.void(ctx.connection, "TX-1")))).toBe("unknown")
        await ctx.sandbox.setNextCase(ctx.account, "void", AMIS_SANDBOX_CASE.voidTransient)
        expect(proofOf(await failureOf(ctx.ledger.void(ctx.connection, "TX-1")))).toBe("not_sent")
        await ctx.sandbox.setNextCase(ctx.account, "void", AMIS_SANDBOX_CASE.voidAppliedLost)
        expect(proofOf(await failureOf(ctx.ledger.void(ctx.connection, "TX-1")))).toBe("unknown")
        expect(await ctx.sandbox.calls(ctx.account, "void")).toHaveLength(4)
    })

    it("MISA-AMIS-7: the account is NOT ready (the live twin's own answer), -1 ready", async () => {
        const ctx = amis()
        await expect(ctx.ledger.ready(ctx.connection)).resolves.toBe(true)
        await ctx.sandbox.setNextCase(ctx.account, "ready", AMIS_SANDBOX_CASE.notReady)
        await expect(ctx.ledger.ready(ctx.connection)).resolves.toBe(false)
    })

    it("the ledger connection refused (-11 append, -15 void) is the same refusal the Google ledger's refused case throws (connection.credential_refused / .revoked)", async () => {
        const ctx = amis()
        await ctx.sandbox.setNextCase(ctx.account, "append", AMIS_SANDBOX_CASE.appendCredentialRefused)
        const appended = await failureOf(ctx.ledger.append(ctx.connection, entry("TX-1")))
        await ctx.sandbox.setNextCase(ctx.account, "void", AMIS_SANDBOX_CASE.voidCredentialRefused)
        const voided = await failureOf(ctx.ledger.void(ctx.connection, "TX-1"))

        const googleAccount = sandboxAccount({ provider: "google" })
        const { sandbox } = sandboxServiceOf(googleAccount)
        const google = new GoogleSandboxLedgerService(sandbox)
        await sandbox.setNextCase(googleAccount, "append", GOOGLE_LEDGER_CASE.appendRefused)
        const googleRefused = await failureOf(
            google.append(connectionRecord({ provider: "google", id: googleAccount.id, workspaceId: googleAccount.workspaceId, sandbox: true }), entry("TX-1")),
        )

        for (const failure of [appended, voided, googleRefused]) {
            expect(failure).toMatchObject({ code: ProviderRegistryErrorCode.LedgerConnectionRefused })
        }
        expect(appended).toMatchObject({ params: { provider: "misa_amis" } })
        expect(voided).toMatchObject({ params: { provider: "misa_amis" } })
        expect(await ctx.sandbox.calls(ctx.account, "append")).toHaveLength(1)
    })
})
