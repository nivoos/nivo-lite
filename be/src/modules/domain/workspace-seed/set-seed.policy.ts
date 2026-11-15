import { createHash } from "node:crypto"
import { SUBJECT_TYPES, type BrainSubjectType } from "@modules/domain/brain-facts/brain-facts.contracts"
import { factSlugOf } from "@modules/domain/brain-facts/fact-key.policy"
import { parseJsonText } from "@modules/platform/primitives"
import { WorkspaceSeedError, WorkspaceSeedErrorCode } from "./errors/workspace-seed.error"
import {
    SET_SEED_SCHEMA,
    type SeedOrigin,
    type SetAccount,
    type SetAgent,
    type SetDocument,
    type SetDoorStep,
    type SetFact,
    type SetFactScope,
    type SetFactSource,
    type SetNodeSetting,
    type SetPerson,
    type SetPlace,
    type SetPlaceBlock,
    type SetPlan,
    type SetPlugin,
    type SetPolicyMark,
    type SetProfile,
    type SetPull,
    type SetSay,
    type SetSecretMember,
    type SetTarget,
} from "./set-seed.contracts"

type Raw = Readonly<Record<string, unknown>>

/** Refuses a set profile, naming the field and nothing of its content. */
const invalid = (field: string): never => {
    throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field } })
}

const isRecord = (value: unknown): value is Raw => value !== null && typeof value === "object" && !Array.isArray(value)

const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/u
const DAY = /^\d{4}-\d{2}-\d{2}$/u
const SOURCES: ReadonlySet<string> = new Set<SetFactSource>(["owner", "manager", "document", "staff"])
const SCOPES: ReadonlySet<string> = new Set<SetFactScope>(["public", "internal"])
const SUBJECTS: ReadonlySet<string> = new Set<string>(SUBJECT_TYPES)
const TARGETS: ReadonlySet<string> = new Set<SetTarget>(["local", "prod", "both"])
const MEMBERS: ReadonlySet<string> = new Set<SetSecretMember>(["credential", "webhookSecret", "apiToken"])
/** A sealed public fact member: `fact.` and a fact name as the account's public facts name it. */
const FACT_MEMBER = /^fact\.[a-z][a-z0-9_]{0,39}$/u
const MODES: ReadonlySet<string> = new Set(["auto", "ask"])
const COMMIT = /^[0-9a-f]{40}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const VERSION = /^\d+\.\d+\.\d+$/u
/** A document of a seed repo: a text file under `knowledge/` (no binary: the data-repo rule), a plain relative path. */
const DOCUMENT_PATH = /^knowledge\/[a-z0-9][a-z0-9._-]{0,99}\.(md|txt)$/u
/** The most truths one profile may expand to: the truth graph's own ceiling, so a set never meets it. */
export const SET_FACTS_MAX = 4500

const text = (value: unknown, field: string, max: number): string =>
    typeof value === "string" && value.trim() !== "" && value.length <= max ? value.trim() : invalid(field)

const optionalText = (value: unknown, field: string, max: number): string | null =>
    value === undefined || value === null ? null : text(value, field, max)

const whole = (value: unknown, field: string, min: number, max: number): number =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : invalid(field)

const list = (value: unknown, field: string): ReadonlyArray<unknown> => (Array.isArray(value) ? value : invalid(field))

const textList = (value: unknown, field: string, max: number): ReadonlyArray<string> => {
    const items = list(value, field).map((item) => text(item, field, max))
    return items.length > 0 ? items : invalid(field)
}

const dayOf = (value: unknown, field: string): string | null =>
    value === undefined || value === null ? null : typeof value === "string" && DAY.test(value) ? value : invalid(field)

/* ----------------------------------------------------------------------------------------------------------- the deterministic part */

/** A small seeded generator (mulberry32): the same seed gives the same numbers on every machine and run; nothing reads a clock or Math.random. */
export const randomOf = (seed: number): (() => number) => {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let mixed = Math.imul(state ^ (state >>> 15), state | 1)
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
    }
}

const pickOf = <T>(rng: () => number, items: ReadonlyArray<T>): T => items[Math.floor(rng() * items.length)] as T

const betweenOf = (rng: () => number, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1))

/** The id of a sandbox account of a set: a UUID derived from the workspace and the account's key, so a rerun finds it and a new workspace never collides with an old one. */
export const connectionIdOf = (workspaceId: string, key: string): string => {
    const hex = createHash("sha1").update(`nivo/set-seed/${workspaceId}/${key}`).digest("hex")
    const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`
}

/** An amount written the Vietnamese way: dots between thousands and the currency mark ("250.000 đ"). */
export const moneyOf = (amount: number, mark: string): string => `${String(amount).replaceAll(/\B(?=(\d{3})+(?!\d))/gu, ".")} ${mark}`

/** The key a truth is known by inside its workspace: its subject and attribute as the truth graph slugs them. */
export const factKeyOf = (fact: Pick<SetFact, "subject" | "attribute">): string => `${factSlugOf(fact.subject)}|${factSlugOf(fact.attribute)}`

/** Whether a day is already past on a given day (both `YYYY-MM-DD`; days compare as text). */
export const isPastDay = (day: string, today: string): boolean => day <= today

/** Where a truth stands for the writer: waiting beside the value in force, expired history, scheduled for later, or in force. */
export type FactStanding = "waiting" | "expired" | "scheduled" | "in_force"

/** The standing a truth is written to, on the given day. */
export const standingOf = (fact: Pick<SetFact, "waiting" | "validFrom" | "validTo">, today: string): FactStanding => {
    if (fact.waiting) return "waiting"
    if (fact.validTo !== null && isPastDay(fact.validTo, today)) return "expired"
    if (fact.validFrom !== null && !isPastDay(fact.validFrom, today)) return "scheduled"
    return "in_force"
}

/* ----------------------------------------------------------------------------------------------------------------------- reading */

const policyOf = (raw: unknown, field: string): SetPolicyMark | null => {
    if (raw === undefined || raw === null) return null
    if (!isRecord(raw)) return invalid(field)
    return { title: text(raw.title, `${field}.title`, 80), group: text(raw.group, `${field}.group`, 40) }
}

const factOf = (raw: unknown, field: string): SetFact => {
    if (!isRecord(raw)) return invalid(field)
    const subjectType = raw.type === undefined ? "business" : text(raw.type, `${field}.type`, 20)
    const source = raw.source === undefined ? "owner" : text(raw.source, `${field}.source`, 20)
    const scope = raw.scope === undefined ? "public" : text(raw.scope, `${field}.scope`, 20)
    if (!SUBJECTS.has(subjectType)) invalid(`${field}.type`)
    if (!SOURCES.has(source)) invalid(`${field}.source`)
    if (!SCOPES.has(scope)) invalid(`${field}.scope`)
    return {
        subjectType: subjectType as BrainSubjectType,
        subject: text(raw.subject, `${field}.subject`, 160),
        attribute: text(raw.attribute, `${field}.attribute`, 120),
        value: text(raw.value, `${field}.value`, 2000),
        unit: optionalText(raw.unit, `${field}.unit`, 40),
        scope: scope as SetFactScope,
        source: source as SetFactSource,
        validFrom: dayOf(raw.from, `${field}.from`),
        validTo: dayOf(raw.to, `${field}.to`),
        waiting: raw.waiting === true,
        policy: policyOf(raw.policy, `${field}.policy`),
    }
}

const sayOf = (raw: unknown, field: string): SetSay | null => {
    if (raw === undefined || raw === null) return null
    if (!isRecord(raw)) return invalid(field)
    return {
        caseId: text(raw.caseId, `${field}.caseId`, 40),
        person: text(raw.person, `${field}.person`, 40),
        text: text(raw.text, `${field}.text`, 40),
        idPrefix: text(raw.idPrefix, `${field}.idPrefix`, 12),
    }
}

/** The secret members a live account names: `credential` at least, each once. */
const membersOf = (raw: unknown, field: string): ReadonlyArray<SetSecretMember> => {
    const names = list(raw, field).map((item) => text(item, field, 40))
    if (names.some((name) => !MEMBERS.has(name) && !FACT_MEMBER.test(name)) || new Set(names).size !== names.length || !names.includes("credential")) invalid(field)
    return names as ReadonlyArray<SetSecretMember>
}

/**
 * One account. A SANDBOX account (the default) holds no secret member; a LIVE account (`sandbox: false`) names its secret members and has no
 * `say` (a person's line on a live account comes from the person, never from a seed).
 */
const accountOf = (raw: unknown, field: string): SetAccount => {
    if (!isRecord(raw)) return invalid(field)
    const key = text(raw.key, `${field}.key`, 40)
    if (!KEY.test(key)) invalid(`${field}.key`)
    if (raw.sandbox !== undefined && typeof raw.sandbox !== "boolean") invalid(`${field}.sandbox`)
    const sandbox = raw.sandbox !== false
    if (sandbox && raw.secrets !== undefined) invalid(`${field}.secrets`)
    if (!sandbox && raw.say !== undefined) invalid(`${field}.say`)
    return {
        key,
        provider: text(raw.provider, `${field}.provider`, 40),
        name: text(raw.name, `${field}.name`, 120),
        sandbox,
        say: sayOf(raw.say, `${field}.say`),
        facts: factsOf(raw.facts, `${field}.facts`),
        secrets: sandbox ? [] : membersOf(raw.secrets, `${field}.secrets`),
        pending: raw.pending === true,
        connectionId: raw.connectionId === undefined ? null : typeof raw.connectionId === "string" && UUID.test(raw.connectionId) ? raw.connectionId : invalid(`${field}.connectionId`),
    }
}

/** The public facts an account opens with: short texts by short names; absent = none. */
const factsOf = (raw: unknown, field: string): Readonly<Record<string, string>> => {
    if (raw === undefined || raw === null) return {}
    if (!isRecord(raw)) return invalid(field)
    return Object.fromEntries(Object.entries(raw).map(([name, value]) => [text(name, field, 40), text(value, `${field}.${name}`, 400)]))
}

const pullOf = (raw: unknown, field: string): SetPull => {
    if (!isRecord(raw)) return invalid(field)
    return { account: text(raw.account, `${field}.account`, 40), caseId: text(raw.caseId, `${field}.caseId`, 40) }
}

const personOf = (raw: unknown, field: string): SetPerson => {
    if (!isRecord(raw)) return invalid(field)
    return {
        channels: list(raw.channels, `${field}.channels`).map((channel, index) => {
            if (!isRecord(channel)) return invalid(`${field}.channels.${String(index)}`)
            return { account: text(channel.account, `${field}.channels.account`, 40), id: text(channel.id, `${field}.channels.id`, 40) }
        }),
        lines: list(raw.lines, `${field}.lines`).map((line, index) => {
            if (!isRecord(line)) return invalid(`${field}.lines.${String(index)}`)
            return { account: text(line.account, `${field}.lines.account`, 40), text: text(line.text, `${field}.lines.text`, 600) }
        }),
        merge: raw.merge === true,
    }
}

/** The settings of one step: its mode, its accounts in try order, or both; neither is refused. */
const nodeSettingOf = (raw: unknown, field: string): SetNodeSetting => {
    if (!isRecord(raw)) return invalid(field)
    const mode = raw.mode === undefined ? null : text(raw.mode, `${field}.mode`, 8)
    if (mode !== null && !MODES.has(mode)) invalid(`${field}.mode`)
    const accounts = raw.accounts === undefined ? null : textList(raw.accounts, `${field}.accounts`, 40)
    if (mode === null && accounts === null) invalid(field)
    return {
        module: text(raw.module, `${field}.module`, 60),
        workflow: text(raw.workflow, `${field}.workflow`, 120),
        node: text(raw.node, `${field}.node`, 120),
        mode: mode as SetNodeSetting["mode"],
        accounts,
    }
}

/** One agent: its module, and the template + version its graph is (both or neither; a workspace seed needs both). */
const agentOf = (raw: unknown, field: string): SetAgent => {
    if (!isRecord(raw)) return invalid(field)
    const module = text(raw.module, `${field}.module`, 60)
    const template = optionalText(raw.template, `${field}.template`, 120)
    const version = raw.version === undefined || raw.version === null ? null : whole(raw.version, `${field}.version`, 1, 1_000_000)
    if ((template === null) !== (version === null)) invalid(`${field}.version`)
    if (template !== null && !template.startsWith(`${module}.`)) invalid(`${field}.template`)
    return { module, template, version }
}

const pluginOf = (raw: unknown, field: string): SetPlugin => {
    if (!isRecord(raw)) return invalid(field)
    const key = text(raw.key, `${field}.key`, 40)
    const version = text(raw.version, `${field}.version`, 20)
    if (!KEY.test(key)) invalid(`${field}.key`)
    if (!VERSION.test(version)) invalid(`${field}.version`)
    return { key, version }
}

const documentOf = (raw: unknown, field: string): SetDocument => {
    if (!isRecord(raw)) return invalid(field)
    const path = text(raw.path, `${field}.path`, 120)
    if (!DOCUMENT_PATH.test(path)) invalid(`${field}.path`)
    const visibility = raw.visibility === undefined ? "internal" : text(raw.visibility, `${field}.visibility`, 20)
    if (!SCOPES.has(visibility)) invalid(`${field}.visibility`)
    return {
        path,
        title: text(raw.title, `${field}.title`, 160),
        topic: text(raw.topic, `${field}.topic`, 80),
        visibility: visibility as SetFactScope,
        module: optionalText(raw.module, `${field}.module`, 60),
    }
}

/** Refuses a field the use does not allow: present (not absent, not an empty list) = refused by its name. */
const absentIn = (raw: Raw, field: string): void => {
    const value = raw[field]
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) invalid(field)
}

/**
 * THE RULE OF THE TWO USES (stated here, judged on the document's content, never on where the file lives):
 * - a TEST set (`use: test`) arrives on stdin with no origin; its accounts are all sandbox (a live account, i.e. a credential, is refused),
 *   its target is `local`, it carries no document and no enterprise; people, history and pulls are allowed (invented).
 * - a WORKSPACE seed (`use: workspace`) is accepted only with the ORIGIN of its `-seed` repo pinned to a 40-hex commit and named like the
 *   document; it states its target (`local | prod | both`), at least one plugin, every agent's template + version; live accounts name their
 *   secret members; it carries foundation only: people, crowd and pulls are refused.
 */
const profileOf = (raw: Raw, origin: SeedOrigin | null): SetProfile => {
    if (raw.schema !== SET_SEED_SCHEMA) invalid("schema")
    const use = raw.use === "test" || raw.use === "workspace" ? raw.use : invalid("use")
    const isSeed = use === "workspace"
    if (isSeed && origin === null) invalid("origin")
    if (!isSeed && origin !== null) invalid("use")
    if (origin !== null && !COMMIT.test(origin.commit)) invalid("origin.commit")
    const name = text(raw.name, "name", 40)
    if (!KEY.test(name)) invalid("name")
    if (origin !== null && origin.name !== name) invalid("name")
    const target = raw.target === undefined && !isSeed ? "local" : text(raw.target, "target", 10)
    if (!TARGETS.has(target) || (!isSeed && target !== "local")) invalid("target")
    const kind = raw.kind === undefined ? "workspace" : raw.kind
    if (kind !== "workspace" && kind !== "overlay") invalid("kind")
    const locale = raw.locale === undefined ? "vi" : raw.locale === "vi" || raw.locale === "en" ? raw.locale : invalid("locale")
    if (isSeed) for (const field of ["people", "crowd", "pulls"]) absentIn(raw, field)
    else for (const field of ["documents", "enterprise"]) absentIn(raw, field)
    const accounts = list(raw.accounts ?? [], "accounts").map((item, index) => accountOf(item, `accounts.${String(index)}`))
    const keys = accounts.map((account) => account.key)
    if (new Set(keys).size !== keys.length) invalid("accounts.key")
    if (!isSeed) accounts.forEach((account, index) => (account.sandbox ? undefined : invalid(`accounts.${String(index)}.sandbox`)))
    if (!isSeed) accounts.forEach((account, index) => (account.connectionId === null ? undefined : invalid(`accounts.${String(index)}.connectionId`)))
    const fixed = accounts.flatMap((account) => (account.connectionId === null ? [] : [account.connectionId]))
    if (new Set(fixed).size !== fixed.length) invalid("accounts.connectionId")
    const agents = list(raw.agents ?? [], "agents").map((item, index) => agentOf(item, `agents.${String(index)}`))
    if (isSeed) agents.forEach((agent, index) => (agent.template === null ? invalid(`agents.${String(index)}.template`) : undefined))
    const plugins = list(raw.plugins ?? [], "plugins").map((item, index) => pluginOf(item, `plugins.${String(index)}`))
    if (isSeed && plugins.length === 0) invalid("plugins")
    const people = list(raw.people ?? [], "people").map((item, index) => personOf(item, `people.${String(index)}`))
    for (const person of people) {
        for (const reference of [...person.channels.map((channel) => channel.account), ...person.lines.map((line) => line.account)]) {
            if (!keys.includes(reference)) invalid("people.account")
        }
    }
    const nodeSettings = list(raw.nodeSettings ?? [], "nodeSettings").map((item, index) => nodeSettingOf(item, `nodeSettings.${String(index)}`))
    for (const setting of nodeSettings) {
        if ((setting.accounts ?? []).some((key) => !keys.includes(key))) invalid("nodeSettings.accounts")
        if (!agents.some((agent) => agent.module === setting.module)) invalid("nodeSettings.module")
    }
    const places = placesOf(raw.places, isSeed, (settings, field) => {
        for (const setting of settings) {
            if ((setting.accounts ?? []).some((key) => !keys.includes(key))) invalid(`${field}.accounts`)
            if (!agents.some((agent) => agent.module === setting.module)) invalid(`${field}.module`)
        }
    })
    const pulls = list(raw.pulls ?? [], "pulls").map((item, index) => pullOf(item, `pulls.${String(index)}`))
    if (pulls.some((pull) => !keys.includes(pull.account))) invalid("pulls.account")
    const documents = list(raw.documents ?? [], "documents").map((item, index) => documentOf(item, `documents.${String(index)}`))
    if (new Set(documents.map((document) => document.title)).size !== documents.length) invalid("documents.title")
    return {
        schema: SET_SEED_SCHEMA,
        use,
        target: target as SetTarget,
        name,
        workspaceName: text(raw.workspaceName, "workspaceName", 120),
        ownerWorkspace: text(raw.ownerWorkspace, "ownerWorkspace", 120),
        kind: kind as "workspace" | "overlay",
        timeZone: optionalText(raw.timeZone, "timeZone", 64),
        locale,
        enterprise: optionalText(raw.enterprise, "enterprise", 40),
        plugins,
        agents,
        accounts,
        truths: list(raw.truths ?? [], "truths").map((item, index) => factOf(item, `truths.${String(index)}`)),
        generators: list(raw.generate ?? [], "generate"),
        documents,
        people,
        crowd: raw.crowd ?? null,
        nodeSettings,
        places,
        pulls,
    }
}

/** The per-place blocks of a workspace seed (`places.<local|prod>.nodeSettings`); a test set has none. */
const placesOf = (
    value: unknown,
    isSeed: boolean,
    judge: (settings: ReadonlyArray<SetNodeSetting>, field: string) => void,
): SetProfile["places"] => {
    if (value === undefined) return {}
    if (!isSeed || !isRecord(value)) return invalid("places")
    const out: Partial<Record<SetPlace, SetPlaceBlock>> = {}
    for (const [place, block] of Object.entries(value)) {
        if (place !== "local" && place !== "prod") invalid("places")
        if (!isRecord(block)) return invalid(`places.${place}`)
        const field = `places.${place}.nodeSettings`
        const settings =
            block.nodeSettings === undefined ? null : list(block.nodeSettings, field).map((item, index) => nodeSettingOf(item, `${field}.${String(index)}`))
        if (settings !== null) judge(settings, field)
        out[place as SetPlace] = { nodeSettings: settings }
    }
    return out
}

/** The node settings a document holds in a place: the place's own block when it names them, else the document's. */
export const nodeSettingsOf = (profile: SetProfile, place: SetPlace): ReadonlyArray<SetNodeSetting> =>
    profile.places[place]?.nodeSettings ?? profile.nodeSettings

/** The TEST set an envelope of the stack seed step carries on stdin (one document, no origin); anything else is refused by the field's name. */
export const readSetProfile = (input: string): SetProfile => {
    const read = parseJsonText(input)
    const envelope = read.ok ? read.value : invalid("input")
    if (!isRecord(envelope) || !Array.isArray(envelope.documents) || envelope.documents.length !== 1) return invalid("input")
    const [entry] = envelope.documents as ReadonlyArray<unknown>
    const raw = isRecord(entry) && isRecord(entry.document) ? entry.document : invalid("input")
    return profileOf(raw, null)
}

/** The WORKSPACE seed of a `-seed` repo: the text of its `seed.json` at the pinned commit `origin` names. */
export const readSeedDocument = (input: string, origin: SeedOrigin): SetProfile => {
    const read = parseJsonText(input)
    const raw = read.ok && isRecord(read.value) ? read.value : invalid("input")
    return profileOf(raw, origin)
}

/* ------------------------------------------------------------------------------------------------------------------- generating */

/** The subjects of a series: a given list, or `count` of them made from kinds and variants with a running code. */
const subjectsOf = (raw: unknown, field: string): ReadonlyArray<string> => {
    if (!isRecord(raw)) return invalid(field)
    if (raw.list !== undefined) return textList(raw.list, `${field}.list`, 160)
    const count = whole(raw.count, `${field}.count`, 1, 2000)
    const kinds = textList(raw.kinds, `${field}.kinds`, 80)
    const variants = textList(raw.variants, `${field}.variants`, 80)
    const code = text(raw.code, `${field}.code`, 6)
    const word = raw.codeWord === undefined ? "mã" : text(raw.codeWord, `${field}.codeWord`, 12)
    return Array.from({ length: count }, (_, index) => {
        const kind = kinds[index % kinds.length] as string
        const variant = variants[Math.floor(index / kinds.length) % variants.length] as string
        return `${kind} ${variant} (${word} ${code}${String(index + 1).padStart(3, "0")})`
    })
}

/** One value of a series attribute, drawn from the block's own generator. */
const valueMakerOf = (raw: unknown, field: string): { readonly make: (rng: () => number) => string; readonly unit: string | null } => {
    if (!isRecord(raw)) return invalid(field)
    const unit = optionalText(raw.unit, `${field}.unit`, 40)
    if (isRecord(raw.money)) {
        const min = whole(raw.money.min, `${field}.money.min`, 0, 1_000_000_000)
        const max = whole(raw.money.max, `${field}.money.max`, min, 1_000_000_000)
        const step = whole(raw.money.step, `${field}.money.step`, 1, 1_000_000)
        const mark = raw.money.mark === undefined ? "đ" : text(raw.money.mark, `${field}.money.mark`, 8)
        return { make: (rng) => moneyOf(min + step * betweenOf(rng, 0, Math.floor((max - min) / step)), mark), unit }
    }
    if (isRecord(raw.percent)) {
        const min = whole(raw.percent.min, `${field}.percent.min`, 0, 100)
        const max = whole(raw.percent.max, `${field}.percent.max`, min, 100)
        return { make: (rng) => `${String(betweenOf(rng, min, max))}%`, unit }
    }
    if (isRecord(raw.number)) {
        const min = whole(raw.number.min, `${field}.number.min`, 0, 1_000_000)
        const max = whole(raw.number.max, `${field}.number.max`, min, 1_000_000)
        return { make: (rng) => String(betweenOf(rng, min, max)), unit }
    }
    const choices = textList(raw.pick, `${field}.pick`, 200)
    return { make: (rng) => pickOf(rng, choices), unit }
}

const filled = (template: string, subject: string, attribute: string): string =>
    template.replaceAll("{subject}", subject).replaceAll("{attribute}", attribute).slice(0, 80)

/** Expands one series block into truths: every subject gets every attribute, each value drawn from the block's seeded generator. */
const seriesOf = (raw: unknown, field: string): ReadonlyArray<SetFact> => {
    if (!isRecord(raw) || raw.generate !== "series") return invalid(`${field}.generate`)
    const rng = randomOf(whole(raw.seed, `${field}.seed`, 0, 4_294_967_295))
    const subjectType = raw.type === undefined ? "business" : text(raw.type, `${field}.type`, 20)
    const source = raw.source === undefined ? "owner" : text(raw.source, `${field}.source`, 20)
    const scope = raw.scope === undefined ? "public" : text(raw.scope, `${field}.scope`, 20)
    if (!SUBJECTS.has(subjectType) || !SOURCES.has(source) || !SCOPES.has(scope)) invalid(`${field}.type`)
    const subjects = subjectsOf(raw.subjects, `${field}.subjects`)
    const makers = list(raw.attributes, `${field}.attributes`).map((item, index) => {
        const where = `${field}.attributes.${String(index)}`
        const label = isRecord(item) ? text(item.label, `${where}.label`, 120) : invalid(where)
        return { label, ...valueMakerOf(item, where) }
    })
    if (makers.length === 0) invalid(`${field}.attributes`)
    const mark = raw.policy === undefined ? null : isRecord(raw.policy) ? raw.policy : invalid(`${field}.policy`)
    const titleTemplate = mark === null ? "" : text(mark.title, `${field}.policy.title`, 80)
    const group = mark === null ? "" : text(mark.group, `${field}.policy.group`, 40)
    return subjects.flatMap((subject) =>
        makers.map((maker) => ({
            subjectType: subjectType as BrainSubjectType,
            subject,
            attribute: maker.label,
            value: maker.make(rng),
            unit: maker.unit,
            scope: scope as SetFactScope,
            source: source as SetFactSource,
            validFrom: null,
            validTo: null,
            waiting: false,
            policy: mark === null ? null : { title: filled(titleTemplate, subject, maker.label), group },
        })),
    )
}

/** The door steps of the people: every person's lines first, in order, then the merges of the persons that ask for one. */
const doorsOf = (people: ReadonlyArray<SetPerson>, accounts: ReadonlyArray<SetAccount>): ReadonlyArray<SetDoorStep> => {
    const lines: Array<SetDoorStep> = []
    const merges: Array<SetDoorStep> = []
    for (const person of people) {
        for (const line of person.lines) {
            const account = accounts.find((one) => one.key === line.account)
            const channel = person.channels.find((one) => one.account === line.account)
            if (account?.say == null || channel === undefined) return invalid("people.lines.account")
            lines.push({
                kind: "line",
                account: account.key,
                caseId: account.say.caseId,
                inputs: { [account.say.person]: channel.id, [account.say.text]: line.text },
            })
        }
        if (person.merge && person.channels.length > 1) merges.push({ kind: "merge", people: person.channels })
    }
    return [...lines, ...merges]
}

/** The crowd: `count` people, each on one account the crowd names, with 1..n lines from the pool; ids run from the account's reserved prefix. */
const crowdOf = (raw: unknown, accounts: ReadonlyArray<SetAccount>): ReadonlyArray<SetPerson> => {
    if (raw === null) return []
    if (!isRecord(raw)) return invalid("crowd")
    const rng = randomOf(whole(raw.seed, "crowd.seed", 0, 4_294_967_295))
    const count = whole(raw.count, "crowd.count", 1, 5000)
    const keys = textList(raw.accounts, "crowd.accounts", 40)
    const lines = isRecord(raw.lines) ? raw.lines : invalid("crowd.lines")
    const min = whole(lines.min, "crowd.lines.min", 1, 50)
    const max = whole(lines.max, "crowd.lines.max", min, 50)
    const texts = textList(raw.texts, "crowd.texts", 600)
    const running = new Map<string, number>()
    return Array.from({ length: count }, (_, index): SetPerson => {
        const key = keys[index % keys.length] as string
        const account = accounts.find((one) => one.key === key)
        if (account?.say == null) return invalid("crowd.accounts")
        const next = (running.get(key) ?? 0) + 1
        running.set(key, next)
        const id = `${account.say.idPrefix}${String(next).padStart(6, "0")}`
        return {
            channels: [{ account: key, id }],
            lines: Array.from({ length: betweenOf(rng, min, max) }, () => ({ account: key, text: pickOf(rng, texts) })),
            merge: false,
        }
    })
}

/**
 * Expands a profile: its hand-written truths, then its generators in order; the people, then the crowd. Pure and deterministic (the same
 * profile gives the same bytes on every run); refused when two truths of one key both claim to be in force at once or the profile is larger
 * than the truth graph's ceiling.
 */
export const expandSetProfile = (profile: SetProfile): SetPlan => {
    const facts = [...profile.truths, ...profile.generators.flatMap((block, index) => seriesOf(block, `generate.${String(index)}`))]
    if (facts.length > SET_FACTS_MAX) invalid("truths")
    const standing = new Map<string, number>()
    for (const fact of facts) {
        if (fact.waiting || fact.validFrom !== null || fact.validTo !== null) continue
        const key = factKeyOf(fact)
        standing.set(key, (standing.get(key) ?? 0) + 1)
    }
    if ([...standing.values()].some((count) => count > 1)) invalid("truths.key")
    const people = [...profile.people, ...crowdOf(profile.crowd, profile.accounts)]
    const pulls = profile.pulls.map((pull): SetDoorStep => ({ kind: "pull", account: pull.account, caseId: pull.caseId }))
    return { facts, doors: [...doorsOf(people, profile.accounts), ...pulls] }
}
