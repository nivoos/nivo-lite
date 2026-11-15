import { proofOf, registrarRefusalReason, type DomainRecord, type DomainRegistrarPort } from "@modules/domain/provider-registry"
import type { SandboxCase } from "@modules/domain/provider-sandbox"
import { TinoSandboxRegistrarService } from "@modules/domain/tino-provider/tino-sandbox-registrar.service"
import { TINO_OPERATION_CASE, TINO_SANDBOX_CASES } from "@modules/domain/tino-provider/tino-sandbox.catalogue"
import { INET_SANDBOX_COVERAGE } from "@modules/domain/inet-provider/inet-sandbox.coverage"
import { TINO_SANDBOX_COVERAGE } from "@modules/domain/tino-provider/tino-sandbox.coverage"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { InetSandboxRegistrarService } from "./inet-sandbox-registrar.service"
import { INET_CASE, INET_OPERATION_CASE, INET_SANDBOX_CASES } from "./inet-sandbox.catalogue"

/*
 * THE SANDBOX STANDARD for the two REGISTRARS (iNET and Tino), proven on both at once: every operation of the port answers every situation
 * its coverage names, with what the live adapter throws (`inetFailureOf` / `tinoFailureOf`: the same error class, code and proof), and a
 * write that applied (the ok case, and the case that applies and then gets no answer) leaves what a read then shows. The second kind of
 * every situation is the other registrar: one table, two providers, the same expectations of the engine (not_sent vs unknown, a refusal
 * vs a failure).
 */

/** What differs between the two registrars: how to build one, the words of its failures, the shape of its refusals. */
interface Registrar {
    readonly name: "inet" | "tino"
    /** The case ids by operation and effect. */
    readonly cases: Readonly<Record<string, Readonly<Record<string, string>>>>
    readonly catalogue: ReadonlyArray<SandboxCase>
    /** A name the catalogue holds. */
    readonly held: string
    readonly authCode: string
    /** The code of the "not now" a case of outcome `transient` throws and what it proves: iNET 429 (not sent), Tino 5xx (unknown). */
    readonly transient: { readonly effect: "rate" | "server"; readonly code: string; readonly proof: "not_sent" | "unknown" }
    /** The refusal reason (and the provider's own words) a `refused` case of each write operation throws. */
    readonly refused: Readonly<Record<string, { readonly reason: string; readonly words: string }>>
    /** The refusal a name the account does not hold gets on a read that needs it. */
    readonly notHeld: string
    readonly registration: { readonly contacts: ReadonlyArray<never> | ReadonlyArray<{ readonly role: "registrant" }> }
}

const build = (kind: "inet" | "tino") => {
    const account = sandboxAccount({ provider: kind })
    const { sandbox } = sandboxServiceOf(account)
    const connection = connectionRecord({
        provider: kind,
        id: account.id,
        workspaceId: account.workspaceId,
        sandbox: true,
        meta: { api_context: "reseller" },
    })
    const registrar: DomainRegistrarPort = kind === "inet" ? new InetSandboxRegistrarService(sandbox) : new TinoSandboxRegistrarService(sandbox)
    return { account, sandbox, connection, registrar }
}

const REGISTRARS: ReadonlyArray<Registrar> = [
    {
        name: "inet",
        cases: INET_OPERATION_CASE,
        catalogue: INET_SANDBOX_CASES,
        held: "a.vn",
        authCode: "INET_AUTH_FAILED",
        transient: { effect: "rate", code: "INET_RATE_LIMITED", proof: "not_sent" },
        refused: {
            register: { reason: "insufficient_balance", words: "insufficient_balance" },
            transfer: { reason: "insufficient_balance", words: "insufficient_balance" },
            createDnsRecord: { reason: "rejected", words: "400" },
            updateDnsRecord: { reason: "rejected", words: "400" },
            deleteDnsRecord: { reason: "rejected", words: "400" },
            updateNameservers: { reason: "rejected", words: "400" },
        },
        notHeld: "not_found",
        registration: { contacts: [{ role: "registrant" }] },
    },
    {
        name: "tino",
        cases: TINO_OPERATION_CASE,
        catalogue: TINO_SANDBOX_CASES,
        held: "d.vn",
        authCode: "TINO_AUTH_FAILED",
        transient: { effect: "server", code: "TINO_FAILED", proof: "unknown" },
        refused: {
            register: { reason: "rejected", words: "not free" },
            transfer: { reason: "rejected", words: "already_in_account" },
            createDnsRecord: { reason: "rejected", words: "record_refused" },
            updateDnsRecord: { reason: "rejected", words: "record_refused" },
            deleteDnsRecord: { reason: "rejected", words: "record_refused" },
            updateNameservers: { reason: "rejected", words: "record_refused" },
        },
        notHeld: "rejected",
        registration: { contacts: [] },
    },
]

const record = (name: string): DomainRecord => ({ name, providerId: "x", status: null, expiresOn: null, nameservers: null, autoRenew: null })
const DNS_INPUT = { name: "www", type: "A", value: "1.2.3.4", ttl: null, priority: null }

/** The failure a promise rejects with (fails when it resolves). */
const failureOf = async (promise: Promise<unknown>): Promise<Error> => {
    try {
        await promise
    } catch (cause) {
        if (cause instanceof Error) return cause
    }
    throw new Error("expected a failure")
}

type Ctx = ReturnType<typeof build>

/** One call of every operation but renew, by operation name, on the held domain (writes of a name not held use a fresh name). */
const callOf = (one: Registrar, ctx: Ctx, operation: string): Promise<unknown> => {
    const { registrar, connection } = ctx
    switch (operation) {
        case "availability":
            return registrar.availability(connection, "free.vn")
        case "find":
            return registrar.find(connection, one.held)
        case "details":
            return registrar.details(connection, record(one.held))
        case "list":
            return registrar.list(connection, { page: 1, pageSize: 2 })
        case "dnsRecords":
            return registrar.dnsRecords(connection, record(one.held))
        case "register":
            return registrar.register(connection, { name: "new.vn", years: 1, nameservers: ["ns.example"], contacts: one.registration.contacts as never })
        case "transfer":
            return registrar.transfer(connection, { name: "moved.vn", authCode: "x", years: 1 })
        case "createDnsRecord":
            return registrar.createDnsRecord(connection, record(one.held), DNS_INPUT)
        case "updateDnsRecord":
            return registrar.updateDnsRecord(connection, record(one.held), "1", { ...DNS_INPUT, name: "api" })
        case "deleteDnsRecord":
            return registrar.deleteDnsRecord(connection, record(one.held), "1")
        case "updateNameservers":
            return registrar.updateNameservers(connection, record(one.held), ["ns9.example"])
        default:
            throw new Error(`no call for ${operation}`)
    }
}

const READS = ["availability", "find", "details", "list", "dnsRecords"] as const
const WRITES = ["register", "transfer", "createDnsRecord", "updateDnsRecord", "deleteDnsRecord", "updateNameservers"] as const

/** What a read shows of the state a write left: the new name, the records, the nameservers. */
const shownAfter = async (one: Registrar, ctx: Ctx, operation: string): Promise<unknown> => {
    const { registrar, connection } = ctx
    switch (operation) {
        case "register":
            return (await registrar.find(connection, "new.vn")) !== null
        case "transfer":
            return (await registrar.find(connection, "moved.vn")) !== null
        case "createDnsRecord":
        case "updateDnsRecord":
        case "deleteDnsRecord": {
            const answer = await registrar.dnsRecords(connection, record(one.held))
            return JSON.stringify(answer.kind === "parsed" ? answer.records : answer.providerData)
        }
        case "updateNameservers":
            return (await registrar.find(connection, one.held))?.nameservers
        default:
            throw new Error(`nothing shown for ${operation}`)
    }
}

describe.each(REGISTRARS)("the $name sandbox answers every registrar situation the standard names", (one) => {
    const caseOf = (operation: string, effect: string): string => {
        const id = one.cases[operation]?.[effect]
        if (id === undefined) throw new Error(`${one.name}: no ${effect} case of ${operation}`)
        return id
    }
    const pick = (ctx: Ctx, operation: string, effect: string) => ctx.sandbox.setNextCase(ctx.account, operation, caseOf(operation, effect))

    describe("the catalogue: one default tagged ok per operation, every case tagged, the tag's first case applies nothing", () => {
        it("names every operation of the port exactly once with exactly one default tagged ok", () => {
            const operations = [...READS, ...WRITES, "renew"]
            for (const operation of operations) {
                const own = one.catalogue.filter((entry) => entry.operation === operation)
                expect(own.length).toBeGreaterThan(0)
                const defaults = own.filter((entry) => entry.default === true)
                expect(defaults).toHaveLength(1)
                expect(defaults[0]?.outcome).toBe("ok")
                expect(own.every((entry) => entry.outcome !== undefined)).toBe(true)
            }
        })

        it.each([...READS, ...WRITES])("%s: the first case tagged refused / transient / timeout applies nothing (a later applied case never comes first)", async (operation) => {
            for (const outcome of ["refused", "transient", "timeout"] as const) {
                const first = one.catalogue.find((entry) => entry.operation === operation && entry.outcome === outcome)
                expect(first).toBeDefined()
                const ctx = build(one.name)
                await ctx.sandbox.setNextCase(ctx.account, operation, first?.id ?? "")
                await failureOf(callOf(one, ctx, operation))
                if ((WRITES as ReadonlyArray<string>).includes(operation)) {
                    expect(await shownAfter(one, ctx, operation)).toBe(await shownAfter(one, build(one.name), operation))
                }
            }
        })
    })

    describe.each([...READS, ...WRITES])("%s", (operation) => {
        it("the default case answers (act.ok / read.ok) and logs one call", async () => {
            const ctx = build(one.name)
            await expect(callOf(one, ctx, operation)).resolves.toBeDefined()
            expect(await ctx.sandbox.calls(ctx.account, operation)).toHaveLength(1)
        })

        if ((READS as ReadonlyArray<string>).includes(operation) || (WRITES as ReadonlyArray<string>).includes(operation)) {
            const hasAuth = one.cases[operation]?.auth !== undefined
            if (hasAuth) {
                it("auth: the gateway refuses the credential: the live class and code, nothing was sent (connection.credential_refused)", async () => {
                    const ctx = build(one.name)
                    await pick(ctx, operation, "auth")
                    const failure = await failureOf(callOf(one, ctx, operation))
                    expect(failure).toMatchObject({ code: one.authCode })
                    expect(proofOf(failure)).toBe("not_sent")
                    // sticky: the same answer on a retry
                    expect(await failureOf(callOf(one, ctx, operation))).toMatchObject({ code: one.authCode })
                })
            }

            it("transient: what the live adapter throws for the provider's 'not now' (act.transient / read.transient)", async () => {
                const ctx = build(one.name)
                await pick(ctx, operation, one.transient.effect)
                const failure = await failureOf(callOf(one, ctx, operation))
                expect(failure).toMatchObject({ code: one.transient.code })
                expect(proofOf(failure)).toBe(one.transient.proof)
            })

            it("timeout: no answer and nothing applied, the outcome unknown (act.timeout / read.timeout)", async () => {
                const ctx = build(one.name)
                await pick(ctx, operation, "timeout")
                const failure = await failureOf(callOf(one, ctx, operation))
                expect(failure).toMatchObject({ code: `${one.name.toUpperCase()}_UNREACHABLE` })
                expect(proofOf(failure)).toBe("unknown")
            })
        }
    })

    describe("reads", () => {
        it("find: the empty case answers null whatever the name, even a name the catalogue holds (read.not_found)", async () => {
            const ctx = build(one.name)
            expect(await ctx.registrar.find(ctx.connection, one.held)).not.toBeNull()
            await pick(ctx, "find", "empty")
            expect(await ctx.registrar.find(ctx.connection, one.held)).toBeNull()
        })

        it.each(["details", "dnsRecords"])("%s: a held name answers, the not_found case refuses with the live reason whatever the name (read.not_found)", async (operation) => {
            const ctx = build(one.name)
            await expect(callOf(one, ctx, operation)).resolves.toBeDefined()
            await pick(ctx, operation, "not_found")
            expect(registrarRefusalReason(await failureOf(callOf(one, ctx, operation)))).toBe(one.notHeld)
            // and by the name alone: a name the catalogue does not hold is refused the same way, with no case picked
            const fresh = build(one.name)
            const reason = registrarRefusalReason(
                await failureOf(operation === "details" ? fresh.registrar.details(fresh.connection, record("zzz.vn")) : fresh.registrar.dnsRecords(fresh.connection, record("zzz.vn"))),
            )
            expect(reason).toBe(one.notHeld)
        })

        it("list: the request's page and pageSize page the four catalogue domains (read.page)", async () => {
            const ctx = build(one.name)
            const first = await ctx.registrar.list(ctx.connection, { page: 1, pageSize: 2 })
            const second = await ctx.registrar.list(ctx.connection, { page: 2, pageSize: 2 })
            expect(first.domains).toHaveLength(2)
            expect(second.domains).toHaveLength(2)
            expect(first.domains.map((domain) => domain.name)).not.toEqual(second.domains.map((domain) => domain.name))
            if (one.name === "inet") expect(first.totalPages).toBe(2)
            else expect(first.totalPages).toBeNull()
        })
    })

    describe("writes", () => {
        it.each(WRITES)("%s refused: the live refusal of the operation (act.refused), nothing applied", async (operation) => {
            const ctx = build(one.name)
            const before = await shownAfter(one, ctx, operation)
            await pick(ctx, operation, "refused")
            const failure = await failureOf(callOf(one, ctx, operation))
            const wanted = one.refused[operation]
            expect(registrarRefusalReason(failure)).toBe(wanted?.reason)
            expect(failure).toMatchObject({ params: { providerCode: wanted?.words } })
            expect(await shownAfter(one, ctx, operation)).toEqual(before)
        })

        it.each(WRITES)("%s: the ok case applies it and a read shows it; applied_timeout applies it then fails unknown, and the confirming read shows it too (act.unknown_applied)", async (operation) => {
            const ok = build(one.name)
            const before = await shownAfter(one, ok, operation)
            await callOf(one, ok, operation)
            const afterOk = await shownAfter(one, ok, operation)
            expect(afterOk).not.toEqual(before)

            const lost = build(one.name)
            await pick(lost, operation, "applied_timeout")
            const failure = await failureOf(callOf(one, lost, operation))
            expect(failure).toMatchObject({ code: `${one.name.toUpperCase()}_UNREACHABLE` })
            expect(proofOf(failure)).toBe("unknown")
            expect(await shownAfter(one, lost, operation)).toEqual(afterOk)
        })

        it("a name the account holds is refused by the live word on register and transfer (the case-free natural refusal)", async () => {
            const ctx = build(one.name)
            const order = { name: one.held, years: 1, nameservers: ["ns.example"], contacts: one.registration.contacts as never }
            const failure = await failureOf(ctx.registrar.register(ctx.connection, order))
            expect(registrarRefusalReason(failure)).toBe(one.name === "inet" ? "already_exists" : "rejected")
            const moved = await failureOf(ctx.registrar.transfer(ctx.connection, { name: one.held, authCode: "x", years: 1 }))
            expect(registrarRefusalReason(moved)).toBe(one.name === "inet" ? "already_exists" : "rejected")
        })

        it("the records of a domain keep their ids: a created record is the next id, an update replaces it, a delete removes it, an unknown id is refused", async () => {
            const ctx = build(one.name)
            await ctx.registrar.createDnsRecord(ctx.connection, record(one.held), DNS_INPUT)
            const read = async (): Promise<string> => {
                const answer = await ctx.registrar.dnsRecords(ctx.connection, record(one.held))
                return JSON.stringify(answer.kind === "parsed" ? answer.records : answer.providerData)
            }
            expect(await read()).toContain("www")
            await ctx.registrar.updateDnsRecord(ctx.connection, record(one.held), "2", { ...DNS_INPUT, name: "api" })
            const updated = await read()
            expect(updated).toContain("api")
            expect(updated).not.toContain("www")
            await ctx.registrar.deleteDnsRecord(ctx.connection, record(one.held), "2")
            expect(await read()).not.toContain("api")
            const missing = await failureOf(ctx.registrar.deleteDnsRecord(ctx.connection, record(one.held), "9"))
            expect(registrarRefusalReason(missing)).toBe(one.name === "inet" ? "not_found" : "rejected")
        })
    })

    describe("renew keeps its own ladder: the tags are what the outcome picker takes", () => {
        it("the first case of each tag is the success / typed refusal / not-sent / nothing-applied one", async () => {
            const firstOf = (outcome: string): string => one.catalogue.find((entry) => entry.operation === "renew" && entry.outcome === outcome)?.id ?? ""
            expect(firstOf("ok")).toBe(one.name === "inet" ? INET_CASE.renewed : "TINO-1")
            expect(firstOf("timeout")).toBe(one.name === "inet" ? INET_CASE.unreachable : "TINO-8")
            expect(firstOf("transient")).toBe(one.name === "inet" ? INET_CASE.rate : "TINO-7")
        })
    })
})

describe("register: the one FINAL refusal the registration tool declares (act.final)", () => {
    it("iNET: the 409 case refuses already_exists whatever the name, and nothing is kept", async () => {
        const ctx = build("inet")
        await ctx.sandbox.setNextCase(ctx.account, "register", INET_OPERATION_CASE.register?.final ?? "")
        const order = { name: "brand-new.vn", years: 1, nameservers: ["ns.example"], contacts: [{ role: "registrant" }] as never }
        const failure = await failureOf(ctx.registrar.register(ctx.connection, order))
        expect(registrarRefusalReason(failure)).toBe("already_exists")
        expect((await ctx.registrar.find(ctx.connection, "brand-new.vn")) === null).toBe(true)
        expect(INET_SANDBOX_CASES.find((entry) => entry.id === INET_OPERATION_CASE.register?.final)?.outcome).toBe("final")
    })

    it("Tino answers no 409: no case is tagged final and the coverage says why (the second kind)", () => {
        expect(TINO_SANDBOX_CASES.some((entry) => entry.outcome === "final")).toBe(false)
        const register = TINO_SANDBOX_COVERAGE.roles.find((role) => role.operation === "register")
        expect(register?.covers["act.final"]).toMatchObject({ na: expect.stringContaining("409") })
        expect(INET_SANDBOX_COVERAGE.roles.find((role) => role.operation === "register")?.covers["act.final"]).toBeUndefined()
    })
})

describe("the renewal's confirmation read after an unknown outcome answers done AND not done (act.confirm_read)", () => {
    it.each([
        ["inet", "INET-6", "2027-12-14", "a.vn"],
        ["inet", "INET-8", "2026-12-14", "a.vn"],
        ["tino", "TINO-6", "2027-12-14", "d.vn"],
        ["tino", "TINO-8", "2026-12-14", "d.vn"],
    ] as const)("%s %s: the read after the failed renew shows expiry %s", async (kind, id, expiry, name) => {
        const ctx = build(kind)
        await ctx.sandbox.setNextCase(ctx.account, "renew", id)
        const failure = await failureOf(ctx.registrar.renew(ctx.connection, { domain: record(name), years: 1 }))
        expect(proofOf(failure)).toBe("unknown")
        expect((await ctx.registrar.find(ctx.connection, name))?.expiresOn).toBe(expiry)
    })
})
