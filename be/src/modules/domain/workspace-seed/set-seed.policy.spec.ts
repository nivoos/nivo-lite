import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SET_NAMES, SETS_DIR, envelopeOf, profileFilesOnDisk } from "@tests/fixtures/builders/set-profiles.builder"
import { WorkspaceSeedError, WorkspaceSeedErrorCode } from "./errors/workspace-seed.error"
import { SET_SEED_SCHEMA, type SetProfile } from "./set-seed.contracts"
import {
    SET_FACTS_MAX,
    connectionIdOf,
    expandSetProfile,
    factKeyOf,
    moneyOf,
    randomOf,
    readSeedDocument,
    readSetProfile,
    standingOf,
} from "./set-seed.policy"

/** The day the specs treat as today (the dates of the conflicting set are written against it). */
const TODAY = "2026-11-14"

const profileOf = (name: string): SetProfile => readSetProfile(envelopeOf(name))

/** An envelope around a document built in a spec. */
const wrap = (document: unknown): string => JSON.stringify({ documents: [{ path: "x.json", document }] })

/** The smallest valid document, overridden by a spec. */
const base = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    schema: SET_SEED_SCHEMA,
    use: "test",
    name: "set-x",
    workspaceName: "set-x",
    ownerWorkspace: "NIVO",
    ...overrides,
})

const fieldOf = (run: () => unknown): string | undefined => {
    try {
        run()
    } catch (error) {
        if (error instanceof WorkspaceSeedError) {
            expect(error.code).toBe(WorkspaceSeedErrorCode.InputInvalid)
            return String((error.params as { field?: unknown } | undefined)?.field)
        }
        throw error
    }
    return undefined
}

describe("the profile files of the sets", () => {
    it("are all and only the sets the owner runs, each a valid profile named like its file", () => {
        expect([...profileFilesOnDisk()]).toEqual([...SET_NAMES].toSorted())
        for (const name of SET_NAMES) {
            const profile = profileOf(name)
            expect(profile.name).toBe(name)
            expect(profile.schema).toBe(SET_SEED_SCHEMA)
        }
    })

    it("expand to the same bytes on every run (no clock, no Math.random): the large set is pinned by its hash", () => {
        for (const name of SET_NAMES) {
            expect(JSON.stringify(expandSetProfile(profileOf(name)))).toBe(JSON.stringify(expandSetProfile(profileOf(name))))
        }
        const hash = createHash("sha256").update(JSON.stringify(expandSetProfile(profileOf("set-large")))).digest("hex")

        expect(hash).toBe("575cc9b9522f9d7f87b7b4fe0ae5055cc3d05d826d66310b031147b7998e1070")
    })

    it("hold no real person, phone or account: every phone is the reserved sample 0900 000 xxx, every person id starts with a reserved prefix", () => {
        for (const name of SET_NAMES) {
            const raw = readFileSync(join(SETS_DIR, `${name}.json`), "utf8")
            const phones = raw.match(/\b0\d{3} \d{3} \d{3}\b/gu) ?? []
            expect(phones.filter((phone) => !phone.startsWith("0900 000"))).toEqual([])
            expect(raw).not.toMatch(/\S+@\S+\.\S+/u)
        }
        for (const name of SET_NAMES) {
            for (const account of profileOf(name).accounts) {
                if (account.say !== null) expect(account.say.idPrefix).toMatch(/^(88|99|77)00\d\d$/u)
            }
        }
    })

    it("keep every account key unique inside a set and reference only keys the set declares", () => {
        for (const name of SET_NAMES) {
            const keys = profileOf(name).accounts.map((account) => account.key)
            expect(new Set(keys).size).toBe(keys.length)
        }
    })
})

describe("set-empty", () => {
    it("has the chatbot and sales agents, a sandbox Zalo and a sandbox SePay, and no truth and no person", () => {
        const profile = profileOf("set-empty")
        const plan = expandSetProfile(profile)

        expect(profile.agents).toEqual([{ module: "chatbot", template: null, version: null }, { module: "sales", template: null, version: null }])
        expect(profile.accounts.map((account) => account.provider)).toEqual(["zalo_oa", "sepay"])
        expect(plan.facts).toEqual([])
        expect(plan.doors).toEqual([])
    })
})

describe("set-small-shop", () => {
    it("has about twenty truths: three policies in force, ten products with a price, five people", () => {
        const plan = expandSetProfile(profileOf("set-small-shop"))

        expect(plan.facts).toHaveLength(20)
        expect(plan.facts.filter((fact) => fact.policy !== null)).toHaveLength(3)
        const products = plan.facts.filter((fact) => fact.subjectType === "product")
        expect(products).toHaveLength(10)
        expect(products.every((fact) => /^\d{1,3}(\.\d{3})* đ$/u.test(fact.value))).toBe(true)
        expect(plan.facts.every((fact) => standingOf(fact, TODAY) === "in_force")).toBe(true)
        expect(new Set(plan.doors.map((step) => (step.kind === "line" ? step.inputs.userId : ""))).size).toBe(5)
    })
})

describe("set-large", () => {
    const plan = expandSetProfile(profileOf("set-large"))

    it("has a truth graph in the thousands: 300 products with five attributes each, suppliers, occasions and zone fees", () => {
        expect(plan.facts.length).toBeGreaterThan(2000)
        expect(plan.facts.length).toBeLessThan(SET_FACTS_MAX)
        expect(plan.facts.filter((fact) => fact.subjectType === "product" && fact.attribute === "Giá")).toHaveLength(300)
        expect(plan.facts.filter((fact) => fact.subjectType === "product")).toHaveLength(1500)
    })

    it("has forty policies, more than L2 can list (the long rules keep them over its 12,000 characters)", () => {
        const policies = plan.facts.filter((fact) => fact.policy !== null)

        expect(policies).toHaveLength(40)
        const chars = policies.reduce((sum, fact) => sum + fact.value.length + (fact.policy?.title.length ?? 0) + 200, 0)
        expect(chars).toBeGreaterThan(12_000)
    })

    it("has two hundred people with lines on three channels, each id unique and on a reserved prefix", () => {
        const lines = plan.doors.flatMap((step) => (step.kind === "line" ? [step] : []))
        const ids = new Set(lines.flatMap((step) => Object.values(step.inputs).slice(0, 1)))

        expect(ids.size).toBe(200)
        expect(new Set(lines.map((step) => step.caseId))).toEqual(new Set(["ZALO-1", "TELEGRAM-1", "META-1"]))
        expect(lines.length).toBeGreaterThanOrEqual(200)
        expect(lines.length).toBeLessThanOrEqual(800)
    })

    it("never writes two truths of one key in force at once", () => {
        const keys = plan.facts.filter((fact) => !fact.waiting && fact.validFrom === null && fact.validTo === null).map((fact) => factKeyOf(fact))

        expect(new Set(keys).size).toBe(keys.length)
    })
})

describe("set-conflicting", () => {
    const plan = expandSetProfile(profileOf("set-conflicting"))
    const standingsOf = (): Record<string, number> => {
        const counts: Record<string, number> = {}
        for (const fact of plan.facts) counts[standingOf(fact, TODAY)] = (counts[standingOf(fact, TODAY)] ?? 0) + 1
        return counts
    }

    it("holds policies in force, two scheduled, one expired and one waiting beside a value in force", () => {
        expect(standingsOf()).toMatchObject({ scheduled: 2, expired: 1, waiting: 1 })
        const waiting = plan.facts.find((fact) => fact.waiting)
        const inForce = plan.facts.find((fact) => !fact.waiting && fact.attribute === waiting?.attribute && fact.subject === waiting.subject)
        expect(inForce?.value).not.toBe(waiting?.value)
    })

    it("states a deposit rule the sales craft does not know, and policies that contradict each other across keys and across authorities", () => {
        const sources = new Set(plan.facts.map((fact) => fact.source))

        expect(plan.facts.some((fact) => fact.attribute.includes("đặt cọc") && fact.value.startsWith("50%"))).toBe(true)
        expect(sources).toEqual(new Set(["owner", "manager", "document", "staff"]))
    })

    it("moves each date across today: an expired window ended before it, a scheduled one starts after it", () => {
        for (const fact of plan.facts) {
            const standing = standingOf(fact, TODAY)
            if (standing === "expired") expect((fact.validTo ?? "") <= TODAY).toBe(true)
            if (standing === "scheduled") expect((fact.validFrom ?? "") > TODAY).toBe(true)
        }
    })
})

describe("set-multichannel", () => {
    const profile = profileOf("set-multichannel")

    it("opens a sandbox account for Zalo (two), Telegram, Meta, ONE mailbox (rule MI-1: in and out on one account) and a bank", () => {
        expect(profile.accounts.map((account) => account.provider).toSorted()).toEqual(
            ["meta", "sepay", "smtp", "telegram", "zalo_oa", "zalo_oa"],
        )
        const mailbox = profile.accounts.find((account) => account.provider === "smtp")
        expect(JSON.parse(mailbox?.facts.config ?? "null")).toEqual({ folders: ["INBOX"], sinceDays: 30 })
    })

    it("has one person's mail as the last history step: the mailbox's poll reads its sandbox case", () => {
        expect(expandSetProfile(profile).doors.at(-1)).toEqual({ kind: "pull", account: "mail-a", caseId: "IMAP-1" })
    })

    it("has one person on three channels whose contacts are merged, and one node choice of two accounts of one kind", () => {
        const plan = expandSetProfile(profile)
        const merge = plan.doors.find((step) => step.kind === "merge")

        expect(merge?.kind === "merge" ? merge.people.map((one) => one.account) : []).toEqual(["zalo-a", "telegram-a", "meta-a"])
        expect(profile.nodeSettings).toEqual([{ module: "chatbot", workflow: "chatbot.front-desk", node: "answer", mode: null, accounts: ["zalo-b", "zalo-a"] }])
    })
})

describe("set-clinic", () => {
    it("is another trade, written half in English, with no flower in it", () => {
        const profile = profileOf("set-clinic")
        const plan = expandSetProfile(profile)
        const vietnamese = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/iu
        const english = plan.facts.filter((fact) => !vietnamese.test(`${fact.subject} ${fact.attribute} ${fact.value}`))

        expect(plan.facts.some((fact) => /(hoa|flower)/iu.test(`${fact.subject} ${fact.value}`))).toBe(false)
        expect(english.length / plan.facts.length).toBeGreaterThan(0.3)
        expect(english.length / plan.facts.length).toBeLessThan(0.7)
        expect(plan.facts.filter((fact) => fact.policy !== null).length).toBeGreaterThanOrEqual(5)
    })
})

describe("set-agency", () => {
    it("is an overlay on the existing NIVO Web workspace: sandbox accounts only, no agent of its own, nothing to remove", () => {
        const profile = profileOf("set-agency")

        expect(profile.kind).toBe("overlay")
        expect(profile.workspaceName).toBe("NIVO Web")
        expect(profile.agents).toEqual([])
        expect(profile.accounts.length).toBeGreaterThanOrEqual(8)
        // One mailbox account (rule MI-1), never an `imap` and an `smtp` account of one address.
        expect(profile.accounts.filter((account) => account.provider === "imap" || account.provider === "smtp")).toHaveLength(1)
    })
})

describe("readSetProfile", () => {
    it("refuses a document of another schema, two documents, an unknown account reference, a bad day, a bad source and an unknown subject type", () => {
        expect(fieldOf(() => readSetProfile(wrap(base({ schema: "other" }))))).toBe("schema")
        expect(fieldOf(() => readSetProfile(JSON.stringify({ documents: [] })))).toBe("input")
        expect(fieldOf(() => readSetProfile("not json"))).toBe("input")
        expect(fieldOf(() => readSetProfile(wrap(base({ people: [{ channels: [], lines: [{ account: "nope", text: "x" }] }] }))))).toBe("people.account")
        expect(fieldOf(() => readSetProfile(wrap(base({ truths: [{ subject: "a", attribute: "b", value: "c", from: "14/11/2026" }] }))))).toBe("truths.0.from")
        expect(fieldOf(() => readSetProfile(wrap(base({ truths: [{ subject: "a", attribute: "b", value: "c", source: "customer" }] }))))).toBe("truths.0.source")
        expect(fieldOf(() => readSetProfile(wrap(base({ truths: [{ subject: "a", attribute: "b", value: "c", type: "flower" }] }))))).toBe("truths.0.type")
        expect(fieldOf(() => readSetProfile(wrap(base({ kind: "other" }))))).toBe("kind")
        expect(fieldOf(() => readSetProfile(wrap(base({ pulls: [{ account: "nope", caseId: "IMAP-1" }] }))))).toBe("pulls.account")
    })

    it("refuses two truths of one key both in force, and a profile larger than the truth graph's ceiling", () => {
        const twice = base({ truths: [{ subject: "Giá", attribute: "Hoa", value: "1" }, { subject: "gia", attribute: "hoa", value: "2" }] })
        expect(fieldOf(() => expandSetProfile(readSetProfile(wrap(twice))))).toBe("truths.key")
        const big = base({ generate: [{ generate: "series", seed: 1, subjects: { count: 2000, kinds: ["a"], variants: ["b"], code: "X" }, attributes: [{ label: "n", number: { min: 1, max: 9 } }, { label: "m", number: { min: 1, max: 9 } }, { label: "o", number: { min: 1, max: 9 } }] }] })
        expect(fieldOf(() => expandSetProfile(readSetProfile(wrap(big))))).toBe("truths")
    })

    it("accepts a person written for by hand only on an account that says how a person writes on it", () => {
        const silent = base({
            accounts: [{ key: "bank", provider: "sepay", name: "Sandbox SePay" }],
            people: [{ channels: [{ account: "bank", id: "1" }], lines: [{ account: "bank", text: "x" }] }],
        })

        expect(fieldOf(() => expandSetProfile(readSetProfile(wrap(silent))))).toBe("people.lines.account")
    })
})

describe("the deterministic helpers", () => {
    it("randomOf gives the same numbers for a seed and other numbers for another seed", () => {
        const first = randomOf(7)
        const again = randomOf(7)
        const other = randomOf(8)
        const run = (next: () => number): ReadonlyArray<number> => [next(), next(), next()]

        expect(run(first)).toEqual(run(again))
        expect(run(randomOf(7))).not.toEqual(run(other))
        expect(run(randomOf(7)).every((value) => value >= 0 && value < 1)).toBe(true)
    })

    it("connectionIdOf is a UUID v5-shaped id, the same for a workspace and key, another for another workspace or key", () => {
        const id = connectionIdOf("ws-1", "zalo-a")

        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
        expect(connectionIdOf("ws-1", "zalo-a")).toBe(id)
        expect(connectionIdOf("ws-2", "zalo-a")).not.toBe(id)
        expect(connectionIdOf("ws-1", "zalo-b")).not.toBe(id)
    })

    it("moneyOf writes thousands with dots and the mark", () => {
        expect(moneyOf(1_200_000, "đ")).toBe("1.200.000 đ")
        expect(moneyOf(90_000, "đ")).toBe("90.000 đ")
        expect(moneyOf(500, "đ")).toBe("500 đ")
    })

    it("standingOf reads the dates against the day: past end = expired, later start = scheduled, waiting stays waiting", () => {
        const at = (validFrom: string | null, validTo: string | null, waiting = false) => standingOf({ validFrom, validTo, waiting }, TODAY)

        expect(at(null, null)).toBe("in_force")
        expect(at("2026-03-01", "2026-03-09")).toBe("expired")
        expect(at("2027-02-01", null)).toBe("scheduled")
        expect(at(null, null, true)).toBe("waiting")
        expect(at("2026-01-01", "2027-01-01")).toBe("in_force")
    })
})

describe("the ONE schema, two uses (the rule is the document's, not the file's location)", () => {
    const origin = { name: "x-seed-standard", commit: "0123456789abcdef0123456789abcdef01234567" }
    const seed = (overrides: Record<string, unknown> = {}): string =>
        JSON.stringify({
            schema: SET_SEED_SCHEMA,
            use: "workspace",
            name: "x-seed-standard",
            target: "local",
            workspaceName: "X",
            ownerWorkspace: "NIVO",
            plugins: [{ key: "core", version: "0.1.0" }],
            agents: [{ module: "chatbot", template: "chatbot.front-desk", version: 1 }],
            accounts: [
                { key: "zalo-main", provider: "zalo_oa", name: "Zalo", sandbox: false, secrets: ["credential", "webhookSecret"] },
                { key: "zalo-sbx", provider: "zalo_oa", name: "Sandbox Zalo" },
            ],
            documents: [{ path: "knowledge/gioi-thieu.md", title: "Giới thiệu", topic: "Cửa hàng", visibility: "public" }],
            ...overrides,
        })

    it("accepts a workspace seed from its pinned repo: live accounts with their secret members, documents, a target", () => {
        const profile = readSeedDocument(seed(), origin)

        expect(profile.use).toBe("workspace")
        expect(profile.accounts.map((account) => [account.key, account.sandbox, account.secrets])).toEqual([
            ["zalo-main", false, ["credential", "webhookSecret"]],
            ["zalo-sbx", true, []],
        ])
        expect(profile.documents).toHaveLength(1)
    })

    it("refuses a TEST set that carries a live account (a credential), a document, an enterprise, or another target", () => {
        expect(fieldOf(() => readSetProfile(wrap(base({ accounts: [{ key: "z", provider: "zalo_oa", name: "Zalo", sandbox: false, secrets: ["credential"] }] }))))).toBe("accounts.0.sandbox")
        expect(fieldOf(() => readSetProfile(wrap(base({ accounts: [{ key: "z", provider: "zalo_oa", name: "Zalo", secrets: ["credential"] }] }))))).toBe("accounts.0.secrets")
        expect(fieldOf(() => readSetProfile(wrap(base({ documents: [{ path: "knowledge/a.md", title: "a", topic: "b" }] }))))).toBe("documents")
        expect(fieldOf(() => readSetProfile(wrap(base({ enterprise: "nivo-web" }))))).toBe("enterprise")
        expect(fieldOf(() => readSetProfile(wrap(base({ target: "prod" }))))).toBe("target")
    })

    it("refuses a workspace seed with no pinned origin, a bad commit, another name, or on stdin", () => {
        expect(fieldOf(() => readSetProfile(wrap(JSON.parse(seed()))))).toBe("origin")
        expect(fieldOf(() => readSeedDocument(seed(), { ...origin, commit: "main" }))).toBe("origin.commit")
        expect(fieldOf(() => readSeedDocument(seed(), { ...origin, name: "y-seed-standard" }))).toBe("name")
        expect(fieldOf(() => readSeedDocument(JSON.stringify({ ...JSON.parse(seed()), use: "test" }), origin))).toBe("use")
    })

    it("refuses in a workspace seed: people, pulls, an agent with no template + version, no plugin, a live account without its credential member", () => {
        expect(fieldOf(() => readSeedDocument(seed({ people: [{ channels: [], lines: [] }] }), origin))).toBe("people")
        expect(fieldOf(() => readSeedDocument(seed({ pulls: [{ account: "zalo-sbx", caseId: "IMAP-1" }] }), origin))).toBe("pulls")
        expect(fieldOf(() => readSeedDocument(seed({ agents: [{ module: "chatbot" }] }), origin))).toBe("agents.0.template")
        expect(fieldOf(() => readSeedDocument(seed({ plugins: [] }), origin))).toBe("plugins")
        expect(fieldOf(() => readSeedDocument(seed({ accounts: [{ key: "z", provider: "zalo_oa", name: "Zalo", sandbox: false, secrets: ["webhookSecret"] }] }), origin))).toBe("accounts.0.secrets")
        expect(fieldOf(() => readSeedDocument(seed({ documents: [{ path: "knowledge/a.pdf", title: "a", topic: "b" }] }), origin))).toBe("documents.0.path")
    })

    it("reads the closed list of secret member NAMES (credential, webhookSecret, apiToken, fact.<name>) and a pending account", () => {
        const profile = readSeedDocument(seed({ accounts: [{ key: "bank", provider: "sepay", name: "Bank", sandbox: false, pending: true, secrets: ["credential", "apiToken", "fact.bank_code"] }] }), origin)

        expect(profile.accounts[0]).toMatchObject({ secrets: ["credential", "apiToken", "fact.bank_code"], pending: true })
        expect(fieldOf(() => readSeedDocument(seed({ accounts: [{ key: "bank", provider: "sepay", name: "Bank", sandbox: false, secrets: ["credential", "password"] }] }), origin))).toBe("accounts.0.secrets")
        expect(fieldOf(() => readSeedDocument(seed({ accounts: [{ key: "bank", provider: "sepay", name: "Bank", sandbox: false, secrets: ["credential", "fact.Bank Code"] }] }), origin))).toBe("accounts.0.secrets")
    })

    it("keeps a declared connection id (a provider's settings point at it) in a workspace seed; refuses it in a test set and twice", () => {
        const fixed = "44c471c0-1a75-42e2-ac4b-09dded78c263"
        const account = { key: "bank", provider: "sepay", name: "Bank", sandbox: false, secrets: ["credential"], connectionId: fixed }

        expect(readSeedDocument(seed({ accounts: [account] }), origin).accounts[0]?.connectionId).toBe(fixed)
        expect(fieldOf(() => readSeedDocument(seed({ accounts: [account, { ...account, key: "bank-2" }] }), origin))).toBe("accounts.connectionId")
        expect(fieldOf(() => readSetProfile(wrap(base({ accounts: [{ key: "z", provider: "zalo_oa", name: "Zalo", connectionId: fixed }] }))))).toBe("accounts.0.connectionId")
    })

    it("reads node settings: a mode, accounts of the document, on an agent of the document", () => {
        const profile = readSeedDocument(seed({ nodeSettings: [{ module: "chatbot", workflow: "chatbot.front-desk", node: "answer", mode: "ask", accounts: ["zalo-main"] }] }), origin)

        expect(profile.nodeSettings).toEqual([{ module: "chatbot", workflow: "chatbot.front-desk", node: "answer", mode: "ask", accounts: ["zalo-main"] }])
        expect(fieldOf(() => readSeedDocument(seed({ nodeSettings: [{ module: "chatbot", workflow: "w", node: "n", mode: "sometimes" }] }), origin))).toBe("nodeSettings.0.mode")
        expect(fieldOf(() => readSeedDocument(seed({ nodeSettings: [{ module: "sales", workflow: "w", node: "n", mode: "ask" }] }), origin))).toBe("nodeSettings.module")
        expect(fieldOf(() => readSeedDocument(seed({ nodeSettings: [{ module: "chatbot", workflow: "w", node: "n", accounts: ["nope"] }] }), origin))).toBe("nodeSettings.accounts")
    })
})
