import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { ACCOUNT_DATA_CATALOG } from "@modules/domain/account-data-catalog"
import { halfOfHost } from "@modules/domain/connections"
import { DELIVER_WEBSITE_FORM_JOB } from "@modules/queues/website-form"
import { APP_TRIGGER_DECLARATIONS } from "@tests/fixtures/builders/app-trigger-declarations"
import { sampleDataOf, triggerMembersOf } from "./trigger-declarations.policy"
import type { TriggerDeclaration, TriggerVia } from "./trigger-declaration.contracts"

/*
 * THE RECEIPT GATE (owner R95 / R96, lane concept triggers): ONE trigger is ONE event, and every way it is received is declared in `via`
 * (a closed list). This gate reads every declaration the app registers (imported from the declaration files, as the sandbox coverage
 * gate reads its registries) and the real registration sites of the source, and fails on:
 *  - a `via` that is empty, holds a way twice or names a way outside the closed list;
 *  - a `withoutPoll` on a trigger a poll receives, or none on a trigger that no poll receives (the reason is the owner's words and the
 *    place the guarantee is stated; the list of webhook-only / engine-only triggers is PRINTED and must equal the list written below, so
 *    adding one is a visible decision);
 *  - a trigger a poll receives whose provider registers no poll receiver of the declaration's `dataType` (live AND sandbox);
 *  - a provider trigger with no `dataType` (and a source of NIVO's own with one), a `dataType` the account-data catalog does not
 *    declare, a `wakes` type with no admission registered;
 *  - `words.members` keys that are no member of `data`, a `data` member whose type its schema does not state;
 *  - a `factKey` on a declaration with `line`, or one that reads anything beside the declared members of the parsed data;
 *  - STATIC: a file outside `account-data/` that imports `AccountDataEntity` or writes `account_data` in raw SQL; a file of
 *    `packages/<name>/src` that declares a trigger receiver or imports a poll / webhook / intake piece of the back end.
 */

/** The `src` folder of the back end, and the repo's packages folder. */
const SRC = join(__dirname, "..", "..", "..")
const PACKAGES = join(SRC, "..", "..", "packages")

/** Every declaration the app registers (the shared fixture). A new source adds its line there and to `REGISTERING`. */
const DECLARATIONS: ReadonlyArray<TriggerDeclaration> = APP_TRIGGER_DECLARATIONS

/** The files that register trigger declarations at boot (`triggerDeclarations.register(`), relative to `be/src`: a new one must be read above. */
const REGISTERING: ReadonlyArray<string> = [
    "features/jobs/deliver-team-chat-tag/transport/queue/deliver-team-chat-tag-queue.module.ts",
    "modules/domain/agent-schedules/agent-schedules.module.ts",
    "modules/domain/bank-feed-inbox/bank-feed-inbox.module.ts",
    "modules/domain/data-hub/data-hub.module.ts",
    "modules/domain/inbox-leads/website-intake.module.ts",
    "modules/domain/meta-inbox/meta-inbox.module.ts",
    "modules/domain/telegram-inbox/telegram-inbox.module.ts",
    "modules/domain/video-compose/video-compose.module.ts",
    "modules/domain/zalo-provider/zalo-provider.module.ts",
]

/**
 * THE NO-POLL LIST: every trigger no poll receives, as `<provider>:<name>`. The gate prints each with its reason and fails when the real
 * list differs from this one: a trigger joining it is a decision somebody reads here, not a silent default.
 */
const NO_POLL: ReadonlyArray<string> = [
    // A provider that forbids a poll while its webhook is set, or has no read of a window, and re-delivers itself (the words are the declaration's).
    "telegram:message.received",
    "meta:facebook.message.received",
    "meta:instagram.message.received",
    "casso:transaction.received",
    "payos:transaction.received",
    "shotstack:render.completed",
    "creatomate:render.completed",
    "json2video:render.completed",
    // A source of NIVO's own: the existing job, sweep or door that brings a missed one back (`withoutPoll.source`). The form's is the job
    // the door writes in the transaction that stores the submission (`website-form.deliver`), like the team chat tag and the workflow start.
    "nivo:form.submitted",
    "nivo:chat.message.received",
    "nivo:clock.tick",
    "nivo:timer.due",
    "nivo:workflow.called",
]

/** Where a no-poll guarantee is stated: the provider's document URL, or `nivo:<the job, queue or tick of NIVO that brings a missed one back>`. */
const SOURCE = /^(?:https?:\/\/\S+|nivo:[\w.:-]+)$/

/** The ways a trigger may be received. */
const WAYS: ReadonlyArray<TriggerVia> = ["webhook", "poll", "clock", "internal"]

const keyOf = (declaration: TriggerDeclaration): string => `${declaration.provider}:${declaration.name}`

/** Every non-spec TypeScript source under a folder (`node_modules` and build output left out). */
const sourcesOf = (folder: string): ReadonlyArray<string> =>
    readdirSync(folder).flatMap((name) => {
        if (name === "node_modules" || name === "dist") return []
        const path = join(folder, name)
        if (statSync(path).isDirectory()) return sourcesOf(path)
        return name.endsWith(".ts") && !name.endsWith(".spec.ts") && !name.endsWith(".d.ts") ? [path] : []
    })

const posix = (root: string, file: string): string => relative(root, file).split(sep).join("/")

/** A value that stands for any collaborator and does nothing: what a receiver is constructed with to read its two constants. */
const inert = (): unknown =>
    new Proxy(function inertTarget() {}, {
        get: (_target, key) => (key === "then" ? undefined : key === Symbol.iterator ? () => [][Symbol.iterator]() : inert()),
        apply: () => inert(),
        construct: () => ({}),
    })

/** The members an object of a class reads as `provider` and `dataType`, or null when the class cannot be read. */
const identityOf = (type: new (...args: ReadonlyArray<unknown>) => object): { readonly provider: string; readonly dataType: string } | null => {
    try {
        const instance = Reflect.construct(type, Array.from({ length: type.length }, () => inert())) as Record<string, unknown>
        const { provider, dataType } = instance
        return typeof provider === "string" && typeof dataType === "string" ? { provider, dataType } : null
    } catch {
        return null
    }
}

/** The classes of the source by name (every `export class X`), with their file. */
const classFilesOf = (sources: ReadonlyArray<{ readonly file: string; readonly text: string }>): ReadonlyMap<string, string> =>
    new Map(sources.flatMap(({ file, text }) => [...text.matchAll(/export class (\w+)/g)].map((match): readonly [string, string] => [match[1] ?? "", file])))

/** One poll receiver registration site: the registry field's type is `PollReceiverRegistryService`. */
interface ReceiverSite {
    readonly site: string
    /** The classes handed as live and sandbox ones; sandbox absent for a bare live registration. */
    readonly live: string
    readonly sandbox: string | null
}

const receiverSitesOf = (sources: ReadonlyArray<{ readonly file: string; readonly text: string }>): ReadonlyArray<ReceiverSite> =>
    sources.flatMap(({ file, text }) => {
        const fields = new Map<string, string>()
        for (const match of text.matchAll(/(?:private|protected|public)?\s*readonly (\w+): (\w+)/g)) fields.set(match[1] ?? "", match[2] ?? "")
        const registryField = [...fields].find(([, type]) => type === "PollReceiverRegistryService")?.[0]
        if (registryField === undefined) return []
        return [...text.matchAll(new RegExp(String.raw`this\.${registryField}\.register\(\s*([^)]*)\)`, "g"))].flatMap((match): ReadonlyArray<ReceiverSite> => {
            const argument = (match[1] ?? "").trim()
            const pair = /live:\s*this\.(\w+)\s*,\s*sandbox:\s*this\.(\w+)/.exec(argument)
            if (pair !== null) {
                return [{ site: posix(SRC, file), live: fields.get(pair[1] ?? "") ?? "", sandbox: fields.get(pair[2] ?? "") ?? "" }]
            }
            const bare = /^this\.(\w+)$/.exec(argument)
            return [{ site: posix(SRC, file), live: fields.get(bare?.[1] ?? "") ?? argument, sandbox: null }]
        })
    })

/** The exports of every module a source file imports by a relative or `@modules` path, by name (the scope an admission's key is read in). */
const importedScopeOf = (file: string, text: string): Record<string, unknown> => {
    const scope: Record<string, unknown> = {}
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
        const specifier = match[2] ?? ""
        try {
            const exported = require(specifier.startsWith(".") ? resolve(dirname(file), specifier) : specifier) as Record<string, unknown>
            for (const name of (match[1] ?? "").split(",").map((part) => part.trim().replace(/^type\s+/, ""))) {
                if (name !== "" && name in exported) scope[name] = exported[name]
            }
        } catch {
            // a module that cannot be loaded here leaves its names out of the scope: the site then reads as unresolved
        }
    }
    return scope
}

/** The first argument of every `admissions.register(` call of a file, as text. */
const admissionKeysOf = (text: string): ReadonlyArray<string> =>
    [...text.matchAll(/admissions\.register\(\s*([^,]+?)\s*,/g)].map((match) => match[1] ?? "")

/** The types an admission registration site registers for the providers given: `X.name`, a constant holding the type's name, or `fn(<variable>)` for each provider. Null: unresolved. */
const admittedTypesOf = (key: string, scope: Record<string, unknown>, providers: ReadonlyArray<string>): ReadonlyArray<string> | null => {
    const named = /^(\w+)\.name$/.exec(key)
    if (named !== null) {
        const value: unknown = scope[named[1] ?? ""]
        const name: unknown = typeof value === "object" && value !== null ? Reflect.get(value, "name") : undefined
        return typeof name === "string" ? [name] : null
    }
    const constant = /^\w+$/.test(key) ? scope[key] : undefined
    if (typeof constant === "string") return [constant]
    const called = /^(\w+)\(\s*\w+\s*\)$/.exec(key)
    const fn: unknown = called === null ? undefined : scope[called[1] ?? ""]
    if (typeof fn !== "function") return null
    const types = providers.flatMap((provider): ReadonlyArray<string> => {
        try {
            const answer: unknown = fn(provider)
            if (typeof answer === "string") return [answer]
            const name: unknown = typeof answer === "object" && answer !== null ? Reflect.get(answer, "name") : undefined
            return typeof name === "string" ? [name] : []
        } catch {
            return []
        }
    })
    return types
}

/** Whether a `factKey` answers the same for the parsed sample of its data and for the sample with an undeclared member added. */
const factKeyReadsDeclaredOnly = (declaration: TriggerDeclaration): boolean => {
    if (declaration.factKey === undefined) return true
    const sample = sampleDataOf(declaration)
    const parsed = declaration.data.safeParse(sample)
    const data: Readonly<Record<string, unknown>> = parsed.success ? parsed.data : sample
    return declaration.factKey(data) === declaration.factKey({ ...data, undeclaredMemberOfTheGate: "x" })
}

describe("trigger receipt gate (R95 / R96): every trigger declares every way it is received", () => {
    it("reads the declarations the app registers, and the files that register them", () => {
        expect(DECLARATIONS.length).toBeGreaterThan(10)
        const registering = sourcesOf(SRC)
            .filter((file) => !posix(SRC, file).startsWith("tests/") && readFileSync(file, "utf8").includes("triggerDeclarations.register("))
            .map((file) => posix(SRC, file))
            .sort()
        expect(registering).toEqual([...REGISTERING].sort())
        expect(new Set(DECLARATIONS.map((declaration) => keyOf(declaration))).size).toBe(DECLARATIONS.length)
    })

    it("has a non-empty `via` of the closed ways, each once", () => {
        const problems = DECLARATIONS.flatMap((declaration) => {
            const via: ReadonlyArray<string> = declaration.via
            if (via.length === 0) return [`${keyOf(declaration)}: via is empty`]
            return [
                ...(new Set(via).size === via.length ? [] : [`${keyOf(declaration)}: via names a way twice`]),
                ...via.filter((way) => !WAYS.includes(way as TriggerVia)).map((way) => `${keyOf(declaration)}: via "${way}" is no way`),
            ]
        })
        expect(problems).toEqual([])
    })

    it("has `withoutPoll` exactly on the triggers no poll receives, with the reason in both languages and where it is stated", () => {
        const problems = DECLARATIONS.flatMap((declaration) => {
            const polled = declaration.via.includes("poll")
            const { withoutPoll } = declaration
            if (polled) return withoutPoll === undefined ? [] : [`${keyOf(declaration)}: withoutPoll on a trigger a poll receives`]
            if (withoutPoll === undefined) return [`${keyOf(declaration)}: no poll receives it and it says no reason (withoutPoll)`]
            return [
                ...(withoutPoll.reason.vi.trim() === "" || withoutPoll.reason.en.trim() === "" ? [`${keyOf(declaration)}: withoutPoll.reason lacks a language`] : []),
                ...(SOURCE.test(withoutPoll.source) ? [] : [`${keyOf(declaration)}: withoutPoll.source "${withoutPoll.source}" is neither a document URL nor nivo:<job or tick>`]),
            ]
        })
        expect(problems).toEqual([])
    })

    it("names for the website form the job its door writes in the transaction that stores the submission, so a stored-but-unwoken submission is recovered by the job frame", () => {
        const form = DECLARATIONS.find((declaration) => keyOf(declaration) === "nivo:form.submitted")
        expect(form?.via).toEqual(["internal"])
        expect(form?.withoutPoll?.source).toBe(`nivo:${DELIVER_WEBSITE_FORM_JOB.name}`)
        expect(DELIVER_WEBSITE_FORM_JOB.ladder).toBe("background")
    })

    it("prints the no-poll list and fails when it differs from the list written in this spec", () => {
        const actual = DECLARATIONS.filter((declaration) => !declaration.via.includes("poll"))
        const lines = actual.map(
            (declaration) =>
                `${keyOf(declaration)} -> ${declaration.withoutPoll?.reason.en ?? "(no reason)"} [${declaration.withoutPoll?.source ?? "no source"}]`,
        )
        console.log(`TRIGGERS RECEIVED BY NO POLL (${lines.length}):\n${lines.join("\n")}`)
        expect(actual.map((declaration) => keyOf(declaration)).sort()).toEqual([...NO_POLL].sort())
    })

    it("has a poll receiver, live and sandbox, of the declaration's provider and data type for every trigger a poll receives", () => {
        const sources = sourcesOf(SRC).map((file) => ({ file, text: readFileSync(file, "utf8") }))
        const classes = classFilesOf(sources)
        const sites = receiverSitesOf(sources)
        const identities = sites.flatMap((site) => {
            const read = (name: string | null): { readonly provider: string; readonly dataType: string } | null => {
                const file = name === null ? undefined : classes.get(name)
                if (file === undefined) return null
                const type: unknown = (require(file) as Record<string, unknown>)[name ?? ""]
                return typeof type === "function" ? identityOf(type as new (...args: ReadonlyArray<unknown>) => object) : null
            }
            return [{ site: site.site, live: read(site.live), sandbox: site.sandbox === null ? "none" : read(site.sandbox) }]
        })
        // The scan reads the real registration sites: the Zalo and SePay receivers (the first providers to register one) are among them.
        expect(identities.map((one) => `${one.live?.provider ?? "?"}:${one.live?.dataType ?? "?"}`)).toEqual(
            expect.arrayContaining(["zalo_oa:zalo_oa.event", "sepay:sepay.transaction"]),
        )
        const problems = DECLARATIONS.filter((declaration) => declaration.via.includes("poll")).flatMap((declaration) => {
            // The receiver of the declaration's provider, or of the half its accounts hold (a mailbox `smtp` account reads through `imap`).
            const readers = [declaration.provider, ...(halfOfHost(declaration.provider) === null ? [] : [halfOfHost(declaration.provider)?.half ?? ""])]
            const held = identities.filter((one) => readers.includes(one.live?.provider ?? "") && one.live?.dataType === declaration.dataType)
            if (held.length === 0) return [`${keyOf(declaration)}: no poll receiver of provider ${declaration.provider} and type ${declaration.dataType ?? "(none)"} is registered`]
            if (held.length > 1) return [`${keyOf(declaration)}: ${held.length} poll receivers register for the same provider and type`]
            const [one] = held
            const sandbox = one?.sandbox
            return sandbox === "none" || sandbox === null || sandbox.provider !== one?.live?.provider || sandbox.dataType !== declaration.dataType
                ? [`${keyOf(declaration)}: its receiver has no sandbox twin of the same provider and type`]
                : []
        })
        expect(problems).toEqual([])
    })

    it("has a data type on every provider trigger, none on a trigger of NIVO's own, and the type declared in the account-data catalog", () => {
        const declared = new Set(ACCOUNT_DATA_CATALOG.map((type) => type.name))
        const problems = DECLARATIONS.flatMap((declaration) => {
            if (declaration.provider === "nivo") return declaration.dataType === undefined ? [] : [`${keyOf(declaration)}: a trigger of NIVO's own names an account_data type`]
            if (declaration.dataType === undefined) return [`${keyOf(declaration)}: a provider trigger without dataType`]
            return declared.has(declaration.dataType) ? [] : [`${keyOf(declaration)}: dataType ${declaration.dataType} is not in the account-data catalog`]
        })
        expect(problems).toEqual([])
    })

    it("has an admission registered for every `wakes` type a provider trigger keeps its rows as", () => {
        const sources = sourcesOf(SRC).map((file) => ({ file, text: readFileSync(file, "utf8") }))
        const providers = [...new Set(DECLARATIONS.map((declaration) => declaration.provider))]
        const registered = new Set<string>()
        const unresolved: Array<string> = []
        for (const { file, text } of sources) {
            const keys = admissionKeysOf(text)
            if (keys.length === 0) continue
            const scope = importedScopeOf(file, text)
            for (const key of keys) {
                const types = admittedTypesOf(key, scope, providers)
                if (types === null) unresolved.push(`${posix(SRC, file)}: ${key}`)
                else for (const type of types) registered.add(type)
            }
        }
        // The scan reads the real registration sites: the types the first providers register an admission for are among them.
        expect([...registered]).toEqual(expect.arrayContaining(["zalo_oa.event", "telegram.update", "meta.event", "sepay.transaction", "shotstack.render"]))
        const wakes = new Set(ACCOUNT_DATA_CATALOG.filter((type) => type.wakes === true).map((type) => type.name))
        const missing = DECLARATIONS.flatMap((declaration) =>
            declaration.dataType !== undefined && wakes.has(declaration.dataType) && !registered.has(declaration.dataType) ? [`${keyOf(declaration)}: no admission is registered for ${declaration.dataType}`] : [],
        )
        expect({ missing, unresolved }).toEqual({ missing: [], unresolved: [] })
    })

    it("words only members of the declaration's data, and every data member states its type", () => {
        const problems = DECLARATIONS.flatMap((declaration) => {
            const members = new Set(triggerMembersOf(declaration.data).map((member) => member.name))
            return Object.keys(declaration.words.members ?? {})
                .filter((name) => !members.has(name))
                .map((name) => `${keyOf(declaration)}: words.members.${name} is no member of data`)
        })
        expect(problems).toEqual([])
    })

    it("has no factKey on a declaration with `line`, and a factKey that reads declared members only", () => {
        const problems = DECLARATIONS.flatMap((declaration) => [
            ...(declaration.factKey !== undefined && declaration.line !== undefined ? [`${keyOf(declaration)}: factKey on a declaration with line`] : []),
            ...(factKeyReadsDeclaredOnly(declaration) ? [] : [`${keyOf(declaration)}: factKey reads a member data does not declare`]),
        ])
        expect(problems).toEqual([])
    })

    it("catches a factKey that reads a member data does not declare (the check itself)", () => {
        const base = DECLARATIONS.find((declaration) => triggerMembersOf(declaration.data).length > 0)
        if (base === undefined) throw new Error("no declaration with data members to try the check on")
        const [member] = triggerMembersOf(base.data)
        const declared = { ...base, factKey: (data: Readonly<Record<string, unknown>>) => String(data[member?.name ?? ""] ?? "") }
        const reading = { ...base, factKey: (data: Readonly<Record<string, unknown>>) => JSON.stringify(Object.keys(data).sort()) }
        expect(factKeyReadsDeclaredOnly(declared)).toBe(true)
        expect(factKeyReadsDeclaredOnly(reading)).toBe(false)
    })
})

describe("account_data has one door (account-data rules 2 and 10)", () => {
    it("no file outside account-data/ imports AccountDataEntity or writes account_data in raw SQL", () => {
        const problems = sourcesOf(SRC).flatMap((file) => {
            const path = posix(SRC, file)
            if (path.startsWith("modules/domain/account-data/") || path.startsWith("tests/")) return []
            const text = readFileSync(file, "utf8")
            return [
                ...(/\bAccountDataEntity\b/.test(text) ? [`${path}: imports AccountDataEntity`] : []),
                ...(/\b(?:insert\s+into|update|delete\s+from)\s+"?account_data/i.test(text) ? [`${path}: writes account_data in raw SQL`] : []),
            ]
        })
        expect(problems).toEqual([])
    })

    it("no packages/<name>/src file declares a trigger receiver or imports a poll / webhook / intake piece of the back end", () => {
        const piece = /(connection-poll|account-data|provider-triggers|provider-registry|@modules\/)/
        const problems = readdirSync(PACKAGES)
            .filter((name) => statSync(join(PACKAGES, name)).isDirectory() && statSync(join(PACKAGES, name, "src"), { throwIfNoEntry: false })?.isDirectory() === true)
            .flatMap((name) =>
                sourcesOf(join(PACKAGES, name, "src")).flatMap((file) => {
                    const text = readFileSync(file, "utf8")
                    const path = posix(PACKAGES, file)
                    const receiver = /\btranslate\s*[(:]/.test(text) && /\bverb\s*:/.test(text) && /\braw\s*:/.test(text)
                    const imports = [...text.matchAll(/from\s+"([^".][^"]*)"/g)].map((match) => match[1] ?? "").filter((specifier) => piece.test(specifier))
                    return [...(receiver ? [`${path}: declares a trigger receiver`] : []), ...imports.map((specifier) => `${path}: imports ${specifier}`)]
                }),
            )
        expect(problems).toEqual([])
    })
})
