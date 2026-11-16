import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import type { SandboxCase } from "@modules/domain/provider-sandbox/provider-sandbox.contracts"
import {
    PER_OPERATION_ROLES,
    SANDBOX_NA_MIN_LENGTH,
    SANDBOX_SITUATIONS,
    type SandboxCoverage,
    type SandboxRole,
} from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * THE SANDBOX STANDARD'S GATE (owner order 2026-11-15 "vét cạn mọi case"; lane concept provider-sandbox rule 18). For EVERY provider
 * kind a connection can hold, read from the source: its sandbox catalogue cases (every exported `SandboxCatalogue` of a
 * `*sandbox*.catalogue.ts` file, merged by provider key as the registry merges them) and its COVERAGE (every exported `SandboxCoverage`
 * of a `*sandbox.coverage.ts` file). It fails when a provider kind has no coverage and is not on the OWED list, when a situation of a
 * role the provider plays has neither a case nor a reason, when a coverage names a case the catalogue does not hold, when an operation
 * of the catalogue is named by no role (a new operation cannot land uncovered), when two catalogues of one provider share an operation
 * (one next-case selector would answer two ports), and when an outbound operation has no single `ok` default.
 */

/** The domain folder the providers live in. */
const DOMAIN = join(__dirname, "..")

/** Provider kinds with no outside system to stand in for (the account IS NIVO's own data). Same list as the coverage law's. */
const NO_OUTSIDE_SYSTEM: ReadonlySet<string> = new Set(["csv_import"])

/**
 * Provider kinds still owed their coverage file, each with the worker who writes it (SBX-LEAD inventory in R4-NOTES). Strike a kind in
 * the change that ships its coverage. It only SHRINKS.
 */
const OWED_COVERAGE: ReadonlySet<string> = new Set<string>([])

/** Every file under a folder whose name matches. */
const filesOf = (folder: string, name: RegExp): ReadonlyArray<string> =>
    readdirSync(folder).flatMap((entry) => {
        const path = join(folder, entry)
        if (statSync(path).isDirectory()) return filesOf(path, name)
        return name.test(entry) && !entry.endsWith(".spec.ts") ? [path] : []
    })

/** The provider kinds of the `Provider` union, read from the source. */
const providerKindsOf = (text: string): ReadonlyArray<string> => {
    const union = /export type Provider =([\s\S]*?)\/\*\*/u.exec(text)?.[1] ?? ""
    return [...union.matchAll(/\|\s*"([a-z0-9_]+)"/gu)].map((match) => match[1] ?? "")
}

/** One case of a provider with the catalogue file that declares it. */
interface PlacedCase {
    readonly one: SandboxCase
    readonly file: string
}

/** The exported values of a file. */
const exportsOf = (file: string): ReadonlyArray<unknown> => Object.values(require(file) as Record<string, unknown>)

/** The cases of every catalogue, by provider key (a case id exported twice, e.g. a catalogue registered under two keys, counts once per key). */
const casesByProvider = (): ReadonlyMap<string, ReadonlyArray<PlacedCase>> => {
    const byProvider = new Map<string, Map<string, PlacedCase>>()
    for (const file of filesOf(DOMAIN, /sandbox.*\.catalogue\.ts$/u)) {
        const place = relative(DOMAIN, file).split(sep).join("/")
        for (const value of exportsOf(file)) {
            if (typeof value !== "object" || value === null) continue
            const provider: unknown = Reflect.get(value, "provider")
            const cases: unknown = Reflect.get(value, "cases")
            if (typeof provider !== "string" || !Array.isArray(cases)) continue
            const kept = byProvider.get(provider) ?? new Map<string, PlacedCase>()
            for (const one of cases as ReadonlyArray<SandboxCase>) kept.set(one.id, { one, file: place })
            byProvider.set(provider, kept)
        }
    }
    return new Map([...byProvider.entries()].map(([provider, kept]) => [provider, [...kept.values()]]))
}

/** Every exported coverage, merged by provider key (a provider whose capabilities live in several folders writes one file per folder). */
const coveragesByProvider = (): ReadonlyMap<string, SandboxCoverage["roles"]> => {
    const byProvider = new Map<string, SandboxCoverage["roles"]>()
    for (const file of filesOf(DOMAIN, /sandbox\.coverage\.ts$/u)) {
        for (const value of exportsOf(file)) {
            if (typeof value !== "object" || value === null) continue
            const provider: unknown = Reflect.get(value, "provider")
            const roles: unknown = Reflect.get(value, "roles")
            if (typeof provider !== "string" || !Array.isArray(roles)) continue
            byProvider.set(provider, [...(byProvider.get(provider) ?? []), ...(roles as SandboxCoverage["roles"])])
        }
    }
    return byProvider
}

/** What is wrong with one provider's coverage against its cases: one line per finding, empty when it meets the standard. */
const findingsOf = (provider: string, roles: SandboxCoverage["roles"], cases: ReadonlyArray<PlacedCase>): ReadonlyArray<string> => {
    const findings: Array<string> = []
    const ids = new Set(cases.map(({ one }) => one.id))
    // The events of the provider: its webhook cases and, for a source NIVO pulls (a mailbox), the cases of its `pull` operations.
    const pulled = new Set(roles.flatMap((entry) => (entry.role === "pull" && entry.operation !== undefined ? [entry.operation] : [])))
    const inbound = cases.filter(({ one }) => one.inbound !== undefined || (one.operation !== undefined && pulled.has(one.operation)))
    const operations = new Set(cases.flatMap(({ one }) => (one.operation === undefined ? [] : [one.operation])))
    const named = new Map<string, Array<string>>()
    const say = (line: string): void => {
        findings.push(`${provider}: ${line}`)
    }

    for (const entry of roles) {
        const at = entry.operation === undefined ? entry.role : `${entry.role}(${entry.operation})`
        const situations = SANDBOX_SITUATIONS[entry.role as SandboxRole]
        if (situations === undefined) {
            say(`${at}: no such role`)
            continue
        }
        if (PER_OPERATION_ROLES.has(entry.role)) {
            if (entry.operation === undefined) say(`${at}: a per-operation role names no operation`)
            else if (!operations.has(entry.operation)) say(`${at}: the catalogue has no case of this operation`)
            else named.set(entry.operation, [...(named.get(entry.operation) ?? []), entry.role])
        } else if (entry.operation !== undefined) say(`${at}: this role is not per operation`)

        const known = new Set(situations.map((one) => one.id))
        for (const key of Object.keys(entry.covers)) if (!known.has(key)) say(`${at}: ${key} is no situation of the role`)
        for (const [key, cover] of Object.entries(entry.covers)) {
            if ("na" in cover && cover.na.trim().length < SANDBOX_NA_MIN_LENGTH) say(`${at}: ${key} n/a has no real reason`)
            if ("cases" in cover) {
                if (cover.cases.length === 0) say(`${at}: ${key} names no case`)
                for (const id of cover.cases) if (!ids.has(id)) say(`${at}: ${key} names ${id}, which the catalogue does not hold`)
            }
        }

        const opCases = cases.filter(({ one }) => entry.operation !== undefined && one.operation === entry.operation)
        for (const situation of situations) {
            const cover = entry.covers[situation.id]
            switch (situation.source.from) {
                case "frame":
                    if (cover !== undefined) say(`${at}: ${situation.id} is made by the frame (mode ${situation.source.mode}); do not declare it`)
                    break
                case "declared":
                    if (cover === undefined) say(`${at}: ${situation.id} has neither a case nor a reason`)
                    break
                case "polled": {
                    const polled = inbound.some(({ one }) => one.inbound?.polled === true)
                    if (!polled && (cover === undefined || !("na" in cover))) say(`${at}: ${situation.id}: no inbound case is \`polled\` and no reason`)
                    if (polled && cover !== undefined) say(`${at}: ${situation.id} is covered by a polled case; do not declare it`)
                    break
                }
                case "outcome": {
                    const wanted = situation.source.outcome
                    const tagged = opCases.some(({ one }) => one.outcome === wanted)
                    if (!tagged && (cover === undefined || !("na" in cover))) say(`${at}: ${situation.id}: no case tagged \`${wanted}\` and no reason`)
                    if (tagged && cover !== undefined) say(`${at}: ${situation.id} is covered by a tagged case; do not declare it`)
                    break
                }
            }
        }

        if (entry.role === "inbound") {
            const shapes = Object.entries(entry.shapes ?? {})
            if (shapes.length === 0) say(`${at}: names no inbound shape`)
            for (const [shape, shapeCases] of shapes) {
                if (shapeCases.length === 0) say(`${at}: shape ${shape} has no case`)
                for (const id of shapeCases) {
                    if (!inbound.some(({ one }) => one.id === id)) say(`${at}: shape ${shape} names ${id}, which is no inbound or pulled case of the catalogue`)
                }
            }
        } else if (entry.shapes !== undefined) say(`${at}: only the inbound role names shapes`)
    }

    if (inbound.length > 0 && !roles.some((entry) => entry.role === "inbound")) say("has inbound cases and no inbound role")
    for (const operation of operations) {
        const namedBy = named.get(operation) ?? []
        // One role per operation, except a long job's START: it is `job` (its life) and `act` (what the start call comes to) at once.
        const jobStart = namedBy.length === 2 && namedBy.includes("job") && namedBy.includes("act")
        if (namedBy.length !== 1 && !jobStart) say(`operation ${operation} is named by ${namedBy.length} per-operation roles (exactly one wanted; a job start is job + act)`)
        const own = cases.filter(({ one }) => one.operation === operation)
        const files = new Set(own.map(({ file }) => file))
        if (files.size > 1) say(`operation ${operation} is answered by ${files.size} catalogues (${[...files].join(", ")}): one next-case selector would serve two ports`)
        const defaults = own.filter(({ one }) => one.default === true)
        if (defaults.length !== 1) say(`operation ${operation} has ${defaults.length} default cases (exactly one wanted)`)
        else if (defaults[0]?.one.outcome !== "ok") say(`operation ${operation}: its default case is not tagged \`ok\``)
        for (const { one } of own) if (one.outcome === undefined) say(`${one.id} (operation ${operation}) is tagged with no outcome`)
    }
    return findings
}

describe("sandbox standard (owner 2026-11-15): every provider covers every situation of its roles", () => {
    const kinds = providerKindsOf(readFileSync(join(DOMAIN, "connections", "connections.contracts.ts"), "utf8")).filter((kind) => !NO_OUTSIDE_SYSTEM.has(kind))
    const cases = casesByProvider()
    const coverages = coveragesByProvider()

    it("reads the real provider kinds, catalogues and the closed situation list", () => {
        expect(kinds).toEqual(expect.arrayContaining(["sepay", "zalo_oa", "inet", "openapi", "model"]))
        expect(cases.get("sepay")?.length ?? 0).toBeGreaterThan(0)
        expect(Object.keys(SANDBOX_SITUATIONS).toSorted()).toEqual(["act", "connection", "inbound", "job", "model", "money", "paylink", "pull", "read"])
    })

    it("refuses a provider kind with no coverage that is not on the owed list", () => {
        expect(kinds.filter((kind) => !coverages.has(kind) && !OWED_COVERAGE.has(kind))).toEqual([])
    })

    it("makes the owed list shrink: a kind that now ships its coverage, or is no kind any more, must leave the list", () => {
        expect([...OWED_COVERAGE].filter((kind) => coverages.has(kind) || !kinds.includes(kind))).toEqual([])
    })

    it("refuses a coverage of a provider that is no kind (a typo, or a key the account can never hold)", () => {
        expect([...coverages.keys()].filter((provider) => !kinds.includes(provider))).toEqual([])
    })

    it("every covered provider meets the standard: each situation has a case or a reason, every operation is named once", () => {
        const findings = [...coverages.entries()].flatMap(([provider, roles]) => findingsOf(provider, roles, cases.get(provider) ?? []))
        expect(findings).toEqual([])
    })

    it("the gate itself refuses a gap, a phantom case, an unnamed operation and a declared frame mode", () => {
        const one = (id: string, extra: Partial<SandboxCase> = {}): PlacedCase => ({ one: { id, label: id, ...extra }, file: "x" })
        const sandbox = [
            one("P-1", { operation: "do", default: true, outcome: "ok" }),
            one("P-2", { operation: "do", outcome: "refused" }),
            one("P-3", { operation: "look", default: true, outcome: "ok" }),
        ]
        const findings = findingsOf("p", [{ role: "act", operation: "do", covers: { "act.unknown_applied": { cases: ["P-9"] } } }], sandbox)

        expect(findings).toEqual(
            expect.arrayContaining([
                "p: act(do): act.unknown_applied names P-9, which the catalogue does not hold",
                "p: act(do): act.replay has neither a case nor a reason",
                "p: act(do): act.final: no case tagged `final` and no reason",
                "p: operation look is named by 0 per-operation roles (exactly one wanted; a job start is job + act)",
            ]),
        )
        expect(findings).not.toEqual(expect.arrayContaining([expect.stringContaining("act.refused")]))
        expect(findingsOf("p", [{ role: "money", covers: { "money.duplicate": { na: "a reason long enough to count" } } }], [])).toEqual(
            expect.arrayContaining(["p: money: money.duplicate is made by the frame (mode twice); do not declare it"]),
        )
    })
})
