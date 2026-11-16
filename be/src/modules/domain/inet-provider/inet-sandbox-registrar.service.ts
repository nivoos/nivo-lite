import { Injectable } from "@nestjs/common"
import type { ConnectionRecord } from "@modules/domain/connections"
import {
    registrarRefusal,
    type DnsRecord,
    type DnsRecordInput,
    type DnsRecordList,
    type DomainAvailability,
    type DomainChange,
    type DomainListQuery,
    type DomainOrderReceipt,
    type DomainPage,
    type DomainRecord,
    type DomainRegistrarPort,
    type DomainRegistrationRequest,
    type DomainRenewalRequest,
    type DomainTransferRequest,
} from "@modules/domain/provider-registry"
import { ProviderSandboxService, type SandboxState } from "@modules/domain/provider-sandbox"
import { INET_PROVIDER } from "./inet-connection-fields.policy"
import { familyOf } from "./inet-domain-registrar.service"
import {
    INET_CASE,
    INET_CASE_EFFECT,
    INET_RENEW_OPERATION,
    INET_SANDBOX_CATALOGUE_DATE,
    INET_SANDBOX_DOMAINS,
    INET_SANDBOX_NAMESERVERS,
    INET_SANDBOX_RENEWAL_PRICE,
    inetSandboxDomainOf,
    type InetCaseEffect,
    type InetSandboxDomain,
} from "./inet-sandbox.catalogue"
import { inetConflict, inetFailureOfEffect, inetRejected, inetUnreachable } from "./inet-sandbox.failures"

/** State name: the expiry a renewal moved (key = domain name, value = `YYYY-MM-DD`); without it the catalogue's expiry applies. */
const EXPIRY = "expiry"

/** State name: the expiry a renewal accepted but not finished will move to (key = domain name, value = `YYYY-MM-DD`, "" = none). */
const PENDING = "pending-expiry"

/** The prices `availability` quotes (the live portal answer states none). */
const NO_PRICES: DomainAvailability["prices"] = []

/** The record a held domain answers to a DNS read (one fixed `A` record). */
const DNS_RECORD = { id: "1", name: "@", type: "A", value: "203.0.113.10", ttl: 3600, priority: null } as const

/** A running reference of an order: `SBX-INET-` and the call's running number (calls of the operation before it, plus one) on six digits. */
const referenceOf = (seq: number): string => `SBX-INET-${String(seq + 1).padStart(6, "0")}`

/** The date `years` years after an ISO date (`YYYY-MM-DD`), by the year only. */
const addYears = (date: string, years: number): string => `${String(Number(date.slice(0, 4)) + years)}${date.slice(4)}`

/** The receipt of a priced order: reference from the running number, total = years x the fixed price. */
const receiptOf = (name: string, years: number, seq: number, expiresOn: string | null): DomainOrderReceipt => ({
    name,
    reference: referenceOf(seq),
    total: years * INET_SANDBOX_RENEWAL_PRICE,
    providerData: { sandbox: true, period: years, ...(expiresOn === null ? {} : { expiresOn }) },
})

/** State name: how many reads of a domain followed a renewal accepted but not finished (key = domain name, an integer; absent = none). */
const PENDING_READS = "pending-reads"

/**
 * The expiry a domain has now: the one a renewal kept, else the catalogue's. A renewal accepted but not finished (the pending case)
 * finishes with the SECOND read of the domain after it (the sandbox's deterministic "later"): the first read, which is the renewal
 * tool's own proof read right after the order, still reports the old expiry, so the order is `pending`; the second read keeps the
 * pending expiry and clears the mark before it answers.
 */
const expiryOf = async (state: SandboxState, domain: InetSandboxDomain): Promise<string> => {
    const pending = await state.read(PENDING, domain.name)
    if (typeof pending === "string" && pending !== "") {
        const seen = await state.read(PENDING_READS, domain.name)
        const reads = (typeof seen === "number" ? seen : 0) + 1
        if (reads >= 2) {
            await state.write(EXPIRY, domain.name, pending)
            await state.write(PENDING, domain.name, "")
            await state.write(PENDING_READS, domain.name, 0)
        } else {
            await state.write(PENDING_READS, domain.name, reads)
        }
    }
    return await settledExpiryOf(state, domain)
}

/** The expiry a domain holds without any read counting toward a pending renewal: the one a renewal kept, else the catalogue's. */
const settledExpiryOf = async (state: SandboxState, domain: InetSandboxDomain): Promise<string> => {
    const kept = await state.read(EXPIRY, domain.name)
    return typeof kept === "string" ? kept : domain.expiresOn
}

/** Keeps the expiry a renewal applied and drops any pending renewal of the domain (the applied one is the newest word). */
const settle = async (state: SandboxState, name: string, expiresOn: string): Promise<void> => {
    await state.write(EXPIRY, name, expiresOn)
    await state.write(PENDING, name, "")
    await state.write(PENDING_READS, name, 0)
}

/** The expiry a renewal starts from (not a read: it does not count toward a pending renewal): the one kept, else the held domain's, else the one the request's record states, else none. */
const renewalBaseOf = async (state: SandboxState, name: string, stated: string | null): Promise<string | null> => {
    const held = await heldOf(state, name)
    if (held !== null) return await settledExpiryOf(state, held)
    const kept = await state.read(EXPIRY, name)
    return typeof kept === "string" ? kept : stated
}

/** State name: the domains the account registered or took in (key = domain name, value = `{ id, expiresOn }`); the catalogue's own are not kept. */
const HELD = "held"

/** State name: the DNS records a write left on a domain (key = domain name, value = the list); without it the one fixed record applies. */
const RECORDS = "dns-records"

/** State name: the nameservers a write left on a domain (key = domain name, value = the list); without it the catalogue's apply. */
const NAMESERVERS = "nameservers"

/** What a case of the account's selector does (the effect its id names), or undefined when nothing is picked or the case is a renewal case with its own handling. */
const effectOf = (state: SandboxState): InetCaseEffect | undefined => (state.nextCase === null ? undefined : INET_CASE_EFFECT.get(state.nextCase))

/** The domain the account holds by a name: the catalogue's, else one it registered or took in, else null. */
const heldOf = async (state: SandboxState, name: string): Promise<InetSandboxDomain | null> => {
    const catalogue = inetSandboxDomainOf(name)
    if (catalogue !== null) return catalogue
    const key = name.trim().toLowerCase()
    const kept = await state.read(HELD, key)
    if (typeof kept !== "object" || kept === null) return null
    const id: unknown = Reflect.get(kept, "id")
    const expiresOn: unknown = Reflect.get(kept, "expiresOn")
    return typeof id === "string" && typeof expiresOn === "string" ? { name: key, id, expiresOn } : null
}

/** Keeps a registered or transferred name in the account's state: an id of the running number, the expiry `years` after the catalogue's fixed day. */
const keepHeld = async (state: SandboxState, name: string, years: number): Promise<void> => {
    const id = `72${String(state.seq + 1).padStart(4, "0")}`
    await state.write(HELD, name.trim().toLowerCase(), { id, expiresOn: addYears(INET_SANDBOX_CATALOGUE_DATE, years) })
}

/** The DNS records of a domain now: what a write left, else the one fixed record. */
const recordsOf = async (state: SandboxState, name: string): Promise<ReadonlyArray<DnsRecord>> => {
    const kept = await state.read(RECORDS, name)
    return Array.isArray(kept) ? (kept as ReadonlyArray<DnsRecord>) : [DNS_RECORD]
}

/** The refusal of a charged order the case `refused` stands for: the reseller balance (the typed `insufficient_balance`). */
const chargeRefused = (): Error => registrarRefusal("insufficient_balance", "insufficient_balance")

/** The refusal of a record or nameserver write the case `refused` stands for: iNET's 400, refused as asked (`rejected`). */
const recordRefused = (): Error => inetRejected("400")

@Injectable()
/**
 * iNET's SANDBOX implementation of the domain registrar port (owner rulings R56, R58, R59, R60, R62), used when the provider account is
 * a sandbox account. Every method answers through ONE sandbox call keyed by the domain name; it reaches no host, and the frame logs the call.
 *
 * EVERY operation has cases (`INET_SANDBOX_CASES`, the standard's ladders): the account's sticky NEXT CASE (`state.nextCase`) of the
 * operation picks the outcome, never the domain name; nothing picked answers the operation's default. A case that fails BEFORE anything is
 * applied (the key refused at the gateway, the rate, a server error, no answer) throws what the live adapter throws for the same iNET
 * failure (`./inet-sandbox.failures`); `refused` is the typed refusal of the operation, `final` the 409 `already_exists`, and
 * `applied_timeout` applies the write and then throws the unknown-outcome failure.
 *
 * `renew` (INET-1..12): success (`INET-1`) moves the domain's expiry in the account's state by the years (from the state's expiry, else the
 * catalogue's, else the one the request's record states: no clock) and answers a receipt `SBX-INET-<n>` (n = calls of `renew` before this
 * one, plus one: a refused call also counts), total = years x the fixed price. A portal-family account (api_context not reseller) is
 * refused `not_available` whatever the case, as live. `INET-3` (pending) answers the same receipt with status `pending` and no new
 * expiry: live iNET publishes no pending answer, so this is the closest truthful shape (an accepted order, not finished); it FINISHES with
 * the next read of that domain (`find`, `details` or `list`), which answers the new expiry (no iNET webhook exists on NIVO: the read is
 * how a registrar order is followed). `INET-6` applies the renewal and then times out.
 *
 * The other writes keep what a read must show: `register` and `transfer` keep the name in the account's state (a later `find`,
 * `availability` and `details` see it; `list` pages the catalogue only), the DNS writes keep the domain's records (a later `dnsRecords`
 * shows them), `updateNameservers` keeps the nameservers (a later read shows them). `find` and `details` answer the catalogue domain
 * with the state's expiry in full (live answers an expiry only for portal accounts: the sandbox always states it, because a renewal is
 * proven by it) and `find` answers null for a name the account holds none of. No idempotency of the sandbox's own (rule 10): iNET takes no
 * idempotency key at all, so a second renew renews again.
 */
export class InetSandboxRegistrarService implements DomainRegistrarPort {
    /** The provider key. */
    readonly provider: typeof INET_PROVIDER = INET_PROVIDER

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Whether a name can be registered: not when the account holds it. */
    async availability(connection: ConnectionRecord, name: string): Promise<DomainAvailability> {
        return await this.read(connection, "availability", { name }, name, async (state) => ({
            name,
            available: (await heldOf(state, name)) === null,
            prices: NO_PRICES,
        }))
    }

    /** The domain the account holds by this name with the state's expiry; null when it holds none (or the case says so). */
    async find(connection: ConnectionRecord, name: string): Promise<DomainRecord | null> {
        return await this.read(connection, "find", { name }, name, async (state, effect) => {
            if (effect === "empty") return null
            const held = await heldOf(state, name)
            return held === null ? null : await this.recordOf(state, held)
        })
    }

    /** The record of one held domain, as `find` answers it. */
    async details(connection: ConnectionRecord, domain: DomainRecord): Promise<DomainRecord> {
        return await this.read(connection, "details", { domain }, domain.name, async (state) => await this.recordOf(state, await this.heldOrRefuse(state, domain.name)))
    }

    /** A page of the catalogue domains (page from 1). */
    async list(connection: ConnectionRecord, query: DomainListQuery): Promise<DomainPage> {
        return await this.read(connection, "list", query, String(query.page), async (state) => {
            const start = (query.page - 1) * query.pageSize
            const rows = INET_SANDBOX_DOMAINS.slice(start, start + query.pageSize)
            const domains = await Promise.all(rows.map((row) => this.recordOf(state, row)))
            return { domains, page: query.page, totalPages: Math.ceil(INET_SANDBOX_DOMAINS.length / query.pageSize) }
        })
    }

    /** Registers a new domain: refused like live without contacts or nameservers, `already_exists` for a name the account holds; else a receipt. */
    async register(connection: ConnectionRecord, request: DomainRegistrationRequest): Promise<DomainOrderReceipt> {
        const served = (): void => {
            if (familyOf(connection) !== "reseller") throw registrarRefusal("not_available", "portal registration undocumented")
            if (request.contacts.length === 0) throw registrarRefusal("contacts_required")
            if (request.nameservers.length === 0) throw registrarRefusal("rejected", "nsList required")
        }
        return await this.act(connection, "register", request, request.name, served, chargeRefused, async (state) => {
            if ((await heldOf(state, request.name)) !== null) throw inetConflict()
            await keepHeld(state, request.name, request.years)
            return receiptOf(request.name, request.years, state.seq, null)
        })
    }

    /** Renews a domain by the account's next case of `renew` (default `INET-1`: renewed); see the class. */
    async renew(connection: ConnectionRecord, request: DomainRenewalRequest): Promise<DomainOrderReceipt> {
        return await this.sandbox.call(connection, INET_RENEW_OPERATION, request, {
            key: request.domain.name,
            answer: async (state) => {
                if (familyOf(connection) !== "reseller" || state.nextCase === INET_CASE.portal) {
                    throw registrarRefusal("not_available", "portal renewal undocumented")
                }
                const name = request.domain.name.trim().toLowerCase()
                const failure = inetFailureOfEffect(effectOf(state))
                if (failure !== null) throw failure
                switch (state.nextCase) {
                    case INET_CASE.insufficientBalance:
                        throw registrarRefusal("insufficient_balance", "insufficient_balance")
                    case INET_CASE.locked:
                        throw registrarRefusal("domain_locked", "domain_locked")
                    case INET_CASE.alreadyRenewed:
                        throw inetConflict()
                    case INET_CASE.notFound:
                        throw registrarRefusal("not_found", "domain")
                }
                const base = await renewalBaseOf(state, name, request.domain.expiresOn)
                const moved = base === null ? null : addYears(base, request.years)
                if (state.nextCase === INET_CASE.appliedTimedOut) {
                    if (moved !== null) await settle(state, name, moved)
                    throw inetUnreachable()
                }
                if (state.nextCase === INET_CASE.pending) {
                    if (moved !== null) {
                        await state.write(PENDING, name, moved)
                        await state.write(PENDING_READS, name, 0)
                    }
                    return { ...receiptOf(request.domain.name, request.years, state.seq, null), providerData: { sandbox: true, period: request.years, status: "pending" } }
                }
                if (moved !== null) await settle(state, name, moved)
                return receiptOf(request.domain.name, request.years, state.seq, moved)
            },
        })
    }

    /** Starts the transfer of a name into the account: a receipt (a name the account holds: `already_exists`). */
    async transfer(connection: ConnectionRecord, request: DomainTransferRequest): Promise<DomainOrderReceipt> {
        const served = (): void => {
            if (familyOf(connection) !== "reseller") throw registrarRefusal("not_available", "portal transfer undocumented")
        }
        return await this.act(connection, "transfer", request, request.name, served, chargeRefused, async (state) => {
            if ((await heldOf(state, request.name)) !== null) throw inetConflict()
            await keepHeld(state, request.name, request.years)
            return receiptOf(request.name, request.years, state.seq, null)
        })
    }

    /** The DNS records of a held domain: parsed for a portal account, the undocumented answer for a reseller one (as live). */
    async dnsRecords(connection: ConnectionRecord, domain: DomainRecord): Promise<DnsRecordList> {
        return await this.read(connection, "dnsRecords", { domain }, domain.name, async (state): Promise<DnsRecordList> => {
            await this.heldOrRefuse(state, domain.name)
            const records = await recordsOf(state, domain.name)
            return familyOf(connection) === "reseller" ? { kind: "undocumented", providerData: { records } } : { kind: "parsed", records }
        })
    }

    /** Adds a DNS record to a held domain. */
    async createDnsRecord(connection: ConnectionRecord, domain: DomainRecord, record: DnsRecordInput): Promise<DomainChange> {
        return await this.changed(connection, "createDnsRecord", domain, { domain, record }, async (state) => {
            const records = await recordsOf(state, domain.name)
            const next = records.reduce((top, one) => Math.max(top, Number(one.id ?? 0)), 0) + 1
            await state.write(RECORDS, domain.name, [...records, { id: String(next), ...record }])
        })
    }

    /** Changes a DNS record of a held domain: the record of that id is replaced (an id the domain has no record of: `not_found`). */
    async updateDnsRecord(
        connection: ConnectionRecord,
        domain: DomainRecord,
        recordId: string,
        record: DnsRecordInput,
    ): Promise<DomainChange> {
        return await this.changed(connection, "updateDnsRecord", domain, { domain, recordId, record }, async (state) => {
            const records = await recordsOf(state, domain.name)
            if (!records.some((one) => one.id === recordId)) throw registrarRefusal("not_found", "record")
            await state.write(RECORDS, domain.name, records.map((one) => (one.id === recordId ? { id: recordId, ...record } : one)))
        })
    }

    /** Removes a DNS record of a held domain (an id the domain has no record of: `not_found`). */
    async deleteDnsRecord(connection: ConnectionRecord, domain: DomainRecord, recordId: string): Promise<DomainChange> {
        return await this.changed(connection, "deleteDnsRecord", domain, { domain, recordId }, async (state) => {
            const records = await recordsOf(state, domain.name)
            if (!records.some((one) => one.id === recordId)) throw registrarRefusal("not_found", "record")
            await state.write(RECORDS, domain.name, records.filter((one) => one.id !== recordId))
        })
    }

    /** Replaces the nameservers of a held domain. */
    async updateNameservers(
        connection: ConnectionRecord,
        domain: DomainRecord,
        nameservers: ReadonlyArray<string>,
    ): Promise<DomainChange> {
        return await this.changed(connection, "updateNameservers", domain, { domain, nameservers }, async (state) => {
            await state.write(NAMESERVERS, domain.name, [...nameservers])
        })
    }

    /** One READ through one sandbox call: the case's failure before anything, `not_found`, else the answer. */
    private async read<T>(
        connection: ConnectionRecord,
        operation: string,
        request: unknown,
        key: string,
        answer: (state: SandboxState, effect: InetCaseEffect | undefined) => Promise<T>,
    ): Promise<T> {
        return await this.sandbox.call(connection, operation, request, {
            key,
            answer: async (state) => {
                const effect = effectOf(state)
                const failure = inetFailureOfEffect(effect)
                if (failure !== null) throw failure
                if (effect === "not_found") throw registrarRefusal("not_found", "domain")
                return await answer(state, effect)
            },
        })
    }

    /**
     * One WRITE through one sandbox call: what the operation's own refusals of the request say first (`served`: nothing was sent), then the
     * case's failure before anything, the typed refusal, `final`, `not_found`; else it applies the write and, for `applied_timeout`,
     * throws the unknown-outcome failure AFTER applying.
     */
    private async act<T>(
        connection: ConnectionRecord,
        operation: string,
        request: unknown,
        key: string,
        served: () => void,
        refusal: () => Error,
        apply: (state: SandboxState) => Promise<T>,
    ): Promise<T> {
        return await this.sandbox.call(connection, operation, request, {
            key,
            answer: async (state) => {
                served()
                const effect = effectOf(state)
                const failure = inetFailureOfEffect(effect)
                if (failure !== null) throw failure
                if (effect === "refused") throw refusal()
                if (effect === "final") throw inetConflict()
                if (effect === "not_found") throw registrarRefusal("not_found", "domain")
                const result = await apply(state)
                if (effect === "applied_timeout") throw inetUnreachable()
                return result
            },
        })
    }

    /** A DNS or nameserver write of a held domain: `rejected` (iNET's 400) for the refused case, `not_found` for a name the account does not hold. */
    private async changed(
        connection: ConnectionRecord,
        operation: string,
        domain: DomainRecord,
        request: unknown,
        write: (state: SandboxState) => Promise<void>,
    ): Promise<DomainChange> {
        return await this.act(connection, operation, request, domain.name, () => undefined, recordRefused, async (state) => {
            await this.heldOrRefuse(state, domain.name)
            await write(state)
            return { name: domain.name, records: null, providerData: { sandbox: true } }
        })
    }

    /** The domain the account holds by a name, or the refusal `not_found`. */
    private async heldOrRefuse(state: SandboxState, name: string): Promise<InetSandboxDomain> {
        const held = await heldOf(state, name)
        if (held === null) throw registrarRefusal("not_found", "domain")
        return held
    }

    /** A held domain in the port's words with the state's expiry and nameservers. */
    private async recordOf(state: SandboxState, held: InetSandboxDomain): Promise<DomainRecord> {
        const kept = await state.read(NAMESERVERS, held.name)
        return {
            name: held.name,
            providerId: held.id,
            status: "active",
            expiresOn: await expiryOf(state, held),
            nameservers: Array.isArray(kept) ? kept.filter((one): one is string => typeof one === "string") : INET_SANDBOX_NAMESERVERS,
            autoRenew: null,
        }
    }
}
