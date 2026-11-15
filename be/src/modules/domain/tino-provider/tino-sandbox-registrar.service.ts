import { Injectable } from "@nestjs/common"
import type { ConnectionRecord } from "@modules/domain/connections"
import {
    registrarRefusal,
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
import { TINO_PROVIDER } from "./tino-connection-fields.policy"
import {
    TINO_CASE,
    TINO_CASE_EFFECT,
    TINO_RENEW_OPERATION,
    TINO_SANDBOX_CATALOGUE_DATE,
    TINO_SANDBOX_DOMAINS,
    TINO_SANDBOX_NAMESERVERS,
    TINO_SANDBOX_PERIODS,
    TINO_SANDBOX_RENEWAL_PRICE,
    tinoSandboxDomainOf,
    type TinoCaseEffect,
    type TinoSandboxDomain,
} from "./tino-sandbox.catalogue"
import { tinoFailureOfEffect, tinoRejected, tinoUnreachable } from "./tino-sandbox.failures"

/** State name: the expiry a renewal moved (key = domain name, value = `YYYY-MM-DD`); without it the catalogue's expiry applies. */
const EXPIRY = "expiry"

/** State name: the expiry a renewal accepted but not finished will move to (key = domain name, value = `YYYY-MM-DD`, "" = none). */
const PENDING = "pending-expiry"

/** The record a held domain answers to a DNS read (Tino's answer is undocumented: it rides as it came). */
const DNS_RECORD = { id: 1, name: "@", type: "A", content: "203.0.113.10" } as const

/** A running reference of an order: `SBX-TINO-` and the call's running number (calls of the operation before it, plus one) on six digits. */
const referenceOf = (seq: number): string => `SBX-TINO-${String(seq + 1).padStart(6, "0")}`

/** The date `years` years after an ISO date (`YYYY-MM-DD`), by the year only. */
const addYears = (date: string, years: number): string => `${String(Number(date.slice(0, 4)) + years)}${date.slice(4)}`

/** State name: how many reads of a domain followed a renewal accepted but not finished (key = domain name, an integer; absent = none). */
const PENDING_READS = "pending-reads"

/**
 * The expiry a domain has now: the one a renewal kept, else the catalogue's. A renewal accepted but not finished (the pending case)
 * finishes with the SECOND read of the domain after it (the sandbox's deterministic "later"): the first read, which is the renewal
 * tool's own proof read right after the order, still reports the old expiry, so the order is `pending`; the second read keeps the
 * pending expiry and clears the mark before it answers.
 */
const expiryOf = async (state: SandboxState, domain: TinoSandboxDomain): Promise<string> => {
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
const settledExpiryOf = async (state: SandboxState, domain: TinoSandboxDomain): Promise<string> => {
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

/** State name: the domains the account ordered or took in (key = domain name, value = `{ id, expiresOn }`); the catalogue's own are not kept. */
const HELD = "held"

/** State name: the DNS records a write left on a domain (key = domain name, value = the list, Tino's own members); without it the one fixed record applies. */
const RECORDS = "dns-records"

/** State name: the nameservers a write left on a domain (key = domain name, value = the list); without it the catalogue's apply. */
const NAMESERVERS = "nameservers"

/** What a case of the account's selector does (the effect its id names), or undefined when nothing is picked or the case is a renewal case with its own handling. */
const effectOf = (state: SandboxState): TinoCaseEffect | undefined => (state.nextCase === null ? undefined : TINO_CASE_EFFECT.get(state.nextCase))

/** The domain the account holds by a name: the catalogue's, else one it ordered or took in, else null. */
const heldOf = async (state: SandboxState, name: string): Promise<TinoSandboxDomain | null> => {
    const catalogue = tinoSandboxDomainOf(name)
    if (catalogue !== null) return catalogue
    const key = name.trim().toLowerCase()
    const kept = await state.read(HELD, key)
    if (typeof kept !== "object" || kept === null) return null
    const id: unknown = Reflect.get(kept, "id")
    const expiresOn: unknown = Reflect.get(kept, "expiresOn")
    return typeof id === "string" && typeof expiresOn === "string" ? { name: key, id, expiresOn } : null
}

/** Keeps an ordered or transferred name in the account's state: an id of the running number, the expiry `years` after the catalogue's fixed day. */
const keepHeld = async (state: SandboxState, name: string, years: number): Promise<void> => {
    const id = `83${String(state.seq + 1).padStart(4, "0")}`
    await state.write(HELD, name.trim().toLowerCase(), { id, expiresOn: addYears(TINO_SANDBOX_CATALOGUE_DATE, years) })
}

/** One DNS record in Tino's own members (its answer is undocumented: it rides as it came). */
interface KeptRecord {
    readonly id: number
    readonly name: string
    readonly type: string
    readonly content: string
}

/** The DNS records of a domain now: what a write left, else the one fixed record. */
const recordsOf = async (state: SandboxState, name: string): Promise<ReadonlyArray<KeptRecord>> => {
    const kept = await state.read(RECORDS, name)
    return Array.isArray(kept) ? (kept as ReadonlyArray<KeptRecord>) : [DNS_RECORD]
}

@Injectable()
/**
 * Tino's SANDBOX implementation of the domain registrar port (owner rulings R56, R58, R59, R60, R62), used when the provider account is a
 * sandbox account. Every method answers through ONE sandbox call keyed by the domain name; it reaches no host, and the frame logs the call.
 *
 * EVERY operation has cases (`TINO_SANDBOX_CASES`, the standard's ladders): the account's sticky NEXT CASE (`state.nextCase`) of the
 * operation picks the outcome, never the domain name; nothing picked answers the operation's default. A case that fails BEFORE anything is
 * applied (the token refused at the gateway, a server error, no answer) throws what the live adapter throws for the same Tino failure
 * (`./tino-sandbox.failures`); `refused` is the route's business refusal (`rejected` with its code), and `applied_timeout` applies the
 * write and then throws the unknown-outcome failure. Tino publishes no 429 and no 409: neither has a case.
 *
 * `renew` (TINO-1..10): success moves the domain's expiry in the account's state by the years (from the state's expiry, else the
 * catalogue's, else the one the request's record states: no clock) and answers a receipt like Tino's renewal answer
 * (`invoice_id` = `SBX-TINO-<n>`, n = calls of `renew` before this one plus one: a refused call also counts; `total` = years x the fixed
 * price). `TINO-3` (pending) answers an accepted order: live Tino publishes no pending answer, so this is the closest truthful shape (the
 * live adapter reads the reference from `invoice_id`, else `order_num`: the pending answer carries only `order_num` and a `pending`
 * status, no invoice, no total, no expiry); it FINISHES with the SECOND read of that domain after it (`find`, `details` or `list`; the
 * renewal's own proof read is the first and still reports the old expiry), which answers the new expiry (no Tino webhook exists on NIVO:
 * the read is how an order is followed). `TINO-6` applies the renewal and then times out.
 *
 * The other writes keep what a read must show: `register` and `transfer` keep the name in the account's state (a later `find`,
 * `availability` and `details` see it; `list` pages the catalogue only), the DNS writes keep the domain's records (a later `dnsRecords`
 * shows them), `updateNameservers` keeps the nameservers. `find` and `details` answer the catalogue domain with the state's expiry and
 * `find` answers null for a name the account holds none of (as live); `list` pages the catalogue (Tino states no page total). No
 * idempotency of the sandbox's own (rule 10): Tino takes no idempotency key at all.
 */
export class TinoSandboxRegistrarService implements DomainRegistrarPort {
    /** The provider key. */
    readonly provider: typeof TINO_PROVIDER = TINO_PROVIDER

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Whether a name can be registered: not when the account holds it; Tino's per-period prices are quoted. */
    async availability(connection: ConnectionRecord, name: string): Promise<DomainAvailability> {
        return await this.read(connection, "availability", { name }, name, async (state) => ({
            name,
            available: (await heldOf(state, name)) === null,
            prices: TINO_SANDBOX_PERIODS,
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
            const rows = TINO_SANDBOX_DOMAINS.slice(start, start + query.pageSize)
            const domains = await Promise.all(rows.map((row) => this.recordOf(state, row)))
            return { domains, page: query.page, totalPages: null }
        })
    }

    /** Orders a new domain: refused like live with contacts (`contacts_unsupported`) or a name not free; else the bare accepted order. */
    async register(connection: ConnectionRecord, request: DomainRegistrationRequest): Promise<DomainOrderReceipt> {
        const served = (): void => {
            if (request.contacts.length > 0) throw registrarRefusal("contacts_unsupported")
        }
        return await this.act(connection, "register", request, request.name, served, () => tinoRejected("not free"), async (state) => {
            if ((await heldOf(state, request.name)) !== null) throw tinoRejected("not free")
            await keepHeld(state, request.name, request.years)
            return { name: request.name, reference: null, total: null, providerData: { sandbox: true } }
        })
    }

    /** Renews a domain by the account's next case of `renew` (default `TINO-1`: renewed); see the class. */
    async renew(connection: ConnectionRecord, request: DomainRenewalRequest): Promise<DomainOrderReceipt> {
        return await this.sandbox.call(connection, TINO_RENEW_OPERATION, request, {
            key: request.domain.name,
            answer: async (state) => {
                const failure = tinoFailureOfEffect(effectOf(state))
                if (failure !== null) throw failure
                switch (state.nextCase) {
                    case TINO_CASE.insufficientBalance:
                        throw registrarRefusal("insufficient_balance", "insufficient_balance")
                    case TINO_CASE.locked:
                        throw registrarRefusal("domain_locked", "domain_locked")
                    case TINO_CASE.alreadyRenewed:
                        throw tinoRejected("domain_already_renewed")
                    case TINO_CASE.notFound:
                        throw tinoRejected("domain_not_held")
                }
                const name = request.domain.name.trim().toLowerCase()
                const base = await renewalBaseOf(state, name, request.domain.expiresOn)
                const moved = base === null ? null : addYears(base, request.years)
                const reference = referenceOf(state.seq)
                if (state.nextCase === TINO_CASE.appliedTimedOut) {
                    if (moved !== null) await settle(state, name, moved)
                    throw tinoUnreachable()
                }
                if (state.nextCase === TINO_CASE.pending) {
                    if (moved !== null) {
                        await state.write(PENDING, name, moved)
                        await state.write(PENDING_READS, name, 0)
                    }
                    return { name: request.domain.name, reference, total: null, providerData: { order_num: reference, status: "pending" } }
                }
                if (moved !== null) await settle(state, name, moved)
                const total = request.years * TINO_SANDBOX_RENEWAL_PRICE
                return {
                    name: request.domain.name,
                    reference,
                    total,
                    providerData: { invoice_id: reference, total, ...(moved === null ? {} : { expires: moved }) },
                }
            },
        })
    }

    /** Starts the transfer of a name into the account: the bare accepted order (a name the account holds is already in it: `rejected`). */
    async transfer(connection: ConnectionRecord, request: DomainTransferRequest): Promise<DomainOrderReceipt> {
        return await this.act(connection, "transfer", request, request.name, () => undefined, () => tinoRejected("already_in_account"), async (state) => {
            if ((await heldOf(state, request.name)) !== null) throw tinoRejected("already_in_account")
            await keepHeld(state, request.name, request.years)
            return { name: request.name, reference: null, total: null, providerData: { sandbox: true } }
        })
    }

    /** The DNS records of a held domain: Tino's undocumented answer, as it came. */
    async dnsRecords(connection: ConnectionRecord, domain: DomainRecord): Promise<DnsRecordList> {
        return await this.read(connection, "dnsRecords", { domain }, domain.name, async (state): Promise<DnsRecordList> => {
            await this.heldOrRefuse(state, domain.name)
            return { kind: "undocumented", providerData: { records: await recordsOf(state, domain.name) } }
        })
    }

    /** Adds a DNS record to a held domain (a ttl is refused, as live: Tino's route takes none). */
    async createDnsRecord(connection: ConnectionRecord, domain: DomainRecord, record: DnsRecordInput): Promise<DomainChange> {
        return await this.changed(connection, "createDnsRecord", domain, { domain, record }, record, async (state) => {
            const records = await recordsOf(state, domain.name)
            const next = records.reduce((top, one) => Math.max(top, Number(one.id)), 0) + 1
            await state.write(RECORDS, domain.name, [...records, { id: next, name: record.name, type: record.type, content: record.value }])
        })
    }

    /** Changes a DNS record of a held domain: the record of that id is replaced (a ttl is refused, as live). */
    async updateDnsRecord(
        connection: ConnectionRecord,
        domain: DomainRecord,
        recordId: string,
        record: DnsRecordInput,
    ): Promise<DomainChange> {
        return await this.changed(connection, "updateDnsRecord", domain, { domain, recordId, record }, record, async (state) => {
            const records = await recordsOf(state, domain.name)
            if (!records.some((one) => String(one.id) === recordId)) throw tinoRejected("record_not_found")
            await state.write(
                RECORDS,
                domain.name,
                records.map((one) => (String(one.id) === recordId ? { id: one.id, name: record.name, type: record.type, content: record.value } : one)),
            )
        })
    }

    /** Removes a DNS record of a held domain. */
    async deleteDnsRecord(connection: ConnectionRecord, domain: DomainRecord, recordId: string): Promise<DomainChange> {
        return await this.changed(connection, "deleteDnsRecord", domain, { domain, recordId }, null, async (state) => {
            const records = await recordsOf(state, domain.name)
            if (!records.some((one) => String(one.id) === recordId)) throw tinoRejected("record_not_found")
            await state.write(RECORDS, domain.name, records.filter((one) => String(one.id) !== recordId))
        })
    }

    /** Replaces the nameservers of a held domain. */
    async updateNameservers(
        connection: ConnectionRecord,
        domain: DomainRecord,
        nameservers: ReadonlyArray<string>,
    ): Promise<DomainChange> {
        return await this.changed(connection, "updateNameservers", domain, { domain, nameservers }, null, async (state) => {
            await state.write(NAMESERVERS, domain.name, [...nameservers])
        })
    }

    /** One READ through one sandbox call: the case's failure before anything, `not_found`, else the answer. */
    private async read<T>(
        connection: ConnectionRecord,
        operation: string,
        request: unknown,
        key: string,
        answer: (state: SandboxState, effect: TinoCaseEffect | undefined) => Promise<T>,
    ): Promise<T> {
        return await this.sandbox.call(connection, operation, request, {
            key,
            answer: async (state) => {
                const effect = effectOf(state)
                const failure = tinoFailureOfEffect(effect)
                if (failure !== null) throw failure
                if (effect === "not_found") throw tinoRejected("domain_not_held")
                return await answer(state, effect)
            },
        })
    }

    /**
     * One WRITE through one sandbox call: what the operation's own refusals of the request say first (`served`: nothing was sent), then the
     * case's failure before anything, the route's refusal, `not_found`; else it applies the write and, for `applied_timeout`, throws the
     * unknown-outcome failure AFTER applying.
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
                const failure = tinoFailureOfEffect(effect)
                if (failure !== null) throw failure
                if (effect === "refused") throw refusal()
                if (effect === "not_found") throw tinoRejected("domain_not_held")
                const result = await apply(state)
                if (effect === "applied_timeout") throw tinoUnreachable()
                return result
            },
        })
    }

    /** A DNS or nameserver write of a held domain (a ttl is refused, as live): `record_refused` for the refused case, `domain_not_held` for a name the account does not hold. */
    private async changed(
        connection: ConnectionRecord,
        operation: string,
        domain: DomainRecord,
        request: unknown,
        record: DnsRecordInput | null,
        write: (state: SandboxState) => Promise<void>,
    ): Promise<DomainChange> {
        const served = (): void => {
            if (record !== null && record.ttl !== null) throw registrarRefusal("rejected", "ttl not taken")
        }
        return await this.act(connection, operation, request, domain.name, served, () => tinoRejected("record_refused"), async (state) => {
            await this.heldOrRefuse(state, domain.name)
            await write(state)
            return { name: domain.name, records: null, providerData: { sandbox: true } }
        })
    }

    /** The domain the account holds by a name, or Tino's business refusal. */
    private async heldOrRefuse(state: SandboxState, name: string): Promise<TinoSandboxDomain> {
        const held = await heldOf(state, name)
        if (held === null) throw tinoRejected("domain_not_held")
        return held
    }

    /** A held domain in the port's words with the state's expiry and nameservers. */
    private async recordOf(state: SandboxState, held: TinoSandboxDomain): Promise<DomainRecord> {
        const kept = await state.read(NAMESERVERS, held.name)
        return {
            name: held.name,
            providerId: held.id,
            status: "Active",
            expiresOn: await expiryOf(state, held),
            nameservers: Array.isArray(kept) ? kept.filter((one): one is string => typeof one === "string") : TINO_SANDBOX_NAMESERVERS,
            autoRenew: false,
        }
    }
}
