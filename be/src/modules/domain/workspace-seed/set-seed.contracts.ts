import type { BrainSubjectType } from "@modules/domain/brain-facts/brain-facts.contracts"

/** The schema name of the one seed document (a test set and a workspace seed alike). */
export const SET_SEED_SCHEMA = "nivo/set-seed@1"

/**
 * Who states a seeded truth. Only the sources whose authority the truth graph orders (owner above manager above document above staff):
 * a seed never writes a customer's or the model's word.
 */
export type SetFactSource = "owner" | "manager" | "document" | "staff"

/** Who may read a seeded truth or document. */
export type SetFactScope = "public" | "internal"

/** The rule a truth is judged to be: the title and group the policy tab shows. A truth with none is judged "not a policy". */
export interface SetPolicyMark {
    /** The title people read. */
    readonly title: string
    /** The group the title is listed under. */
    readonly group: string
}

/** One truth of the workspace, as a document (or one of its generators) declares it. */
export interface SetFact {
    /** The kind of subject. */
    readonly subjectType: BrainSubjectType
    /** The subject as people write it. */
    readonly subject: string
    /** The attribute as people write it. */
    readonly attribute: string
    /** The value as people write it ("250.000 đ", "10%", "08:00-21:00"). */
    readonly value: string
    /** The unit kept apart, or null. */
    readonly unit: string | null
    /** Who may read it. */
    readonly scope: SetFactScope
    /** Who states it. */
    readonly source: SetFactSource
    /** From when it holds (a day, `YYYY-MM-DD`), or null; a later day makes the truth SCHEDULED. */
    readonly validFrom: string | null
    /** Until when it holds (a day), or null; a day already past makes the truth EXPIRED history. */
    readonly validTo: string | null
    /** True for a value that only WAITS for the founder beside the value in force of its key (a document that disagrees). */
    readonly waiting: boolean
    /** The policy mark, or null for a truth that is not a rule of how the business operates. */
    readonly policy: SetPolicyMark | null
}

/**
 * The secret members a live account may name, a CLOSED list of the app's own sealed slots of a connection: `credential` (the text the app
 * seals), `webhookSecret` (its webhook's own secret), `apiToken` (the connection's API token slot), and `fact.<name>` (a PUBLIC fact of the
 * account whose value the repository keeps sealed: merged into the account's public facts when applied). No member holds a value here.
 */
export type SetSecretMember = "credential" | "webhookSecret" | "apiToken" | `fact.${string}`

/**
 * One account of the document: its key names it inside the document; its id is derived from the workspace and the key. A SANDBOX account
 * holds no credential and `say` tells the contact doors how a person writes on it (the provider's own inbound case: provider words only). A
 * LIVE account (a workspace seed only) names its SECRET MEMBERS: the names under `accounts.<key>` of the repo's sealed file whose values the
 * applier hands to the app's own connection door (`credential` = the text the app seals, `webhookSecret` = its webhook's own secret).
 */
export interface SetAccount {
    /** The key of the account inside the document (`zalo-a`). */
    readonly key: string
    /** The provider kind. */
    readonly provider: string
    /** The name shown for the account. */
    readonly name: string
    /** True for a sandbox account (no credential); false for a live one. */
    readonly sandbox: boolean
    /** How a person writes on it (a sandbox account only); none for an account no person writes on, or whose people come by its poll. */
    readonly say: SetSay | null
    /**
     * The public facts the account opens with (provider words, short texts): a mailbox account's inbound half (`config`, MAIL-IN rule MI-1)
     * so it is an entrance. Empty for most.
     */
    readonly facts: Readonly<Record<string, string>>
    /** The names of its secret members (a live account: `credential` at least); empty for a sandbox account. */
    readonly secrets: ReadonlyArray<SetSecretMember>
    /**
     * The connection id a provider's own settings already point at (its webhook URL names it), declared by a workspace standard so the id
     * survives a wipe; null = derived (a standard: from its name and the key, the same in every environment and after every wipe; a test
     * set: from the workspace and the key).
     */
    readonly connectionId: string | null
    /** True for an account that opens PENDING (a person's consent or test completes it: an OAuth client before its owner's consent). */
    readonly pending: boolean
}

/** A case of an account's POLL a door step picks (the provider's own sandbox case the next poll of the account reads: a mailbox's mails). */
export interface SetPull {
    /** The account key. */
    readonly account: string
    /** The case of the provider's sandbox catalogue the account's next poll reads (`IMAP-1`). */
    readonly caseId: string
}

/** The provider's inbound case a person's line goes through, with the names of its inputs. */
export interface SetSay {
    /** The inbound case id of the provider's catalogue (`ZALO-1`). */
    readonly caseId: string
    /** The input that names the person. */
    readonly person: string
    /** The input that holds the line. */
    readonly text: string
    /** The digits every generated person id on this account starts with (reserved, obviously fake). */
    readonly idPrefix: string
}

/** One person written for by hand: ids per account and lines. */
export interface SetPerson {
    /** The ids of the person on accounts: account key and the provider's own id. */
    readonly channels: ReadonlyArray<{ readonly account: string; readonly id: string }>
    /** The lines the person says, in order. */
    readonly lines: ReadonlyArray<{ readonly account: string; readonly text: string }>
    /** True to merge the person's contacts of every channel into one contact after the lines (a person's decision). */
    readonly merge: boolean
}

/** The modes a step runs in: on its own, or after a person's yes. */
export type SetNodeMode = "auto" | "ask"

/**
 * The NODE SETTINGS of one step (the closed list of R75: the step's one mode and which attached accounts it uses, in try order), written as a
 * new version of the workflow through the api's judged door `setAgentNodeSettings` (a door step: the cli composes no such door).
 */
export interface SetNodeSetting {
    /** The module whose agent holds the workflow. */
    readonly module: string
    /** The workflow key. */
    readonly workflow: string
    /** The node key. */
    readonly node: string
    /** The step's mode, or null to keep the template's. */
    readonly mode: SetNodeMode | null
    /** The account keys the step uses, in try order, or null to keep the default pick. */
    readonly accounts: ReadonlyArray<string> | null
}

/** The two uses of the one seed schema; the rule that separates them is stated on `SetProfile`. */
export type SetUse = "test" | "workspace"

/** Where a document is applied: the local stack, production, or both (the enterprise seed's own words). */
export type SetTarget = "local" | "prod" | "both"

/** An agent of the workspace: its module, and (a workspace seed: required) the template its graph IS and that template's version. */
export interface SetAgent {
    /** The module key. */
    readonly module: string
    /** The template id (`<module>.<slug>`, the module's primary template), or null = the primary as installed (a test set only). */
    readonly template: string | null
    /** The template version, or null = the installed one (a test set only). */
    readonly version: number | null
}

/** A plugin the workspace needs, with the version of its package the seed was written for. */
export interface SetPlugin {
    /** The plugin key of the installation (`core`, `nivo-web-core`). */
    readonly key: string
    /** The package version the seed was written for (`0.1.0`). */
    readonly version: string
}

/** A document of the workspace's knowledge: a text file of the seed repo, kept through the knowledge door so its job chain files truths. */
export interface SetDocument {
    /** The repo-relative path (`knowledge/<file>.md`). */
    readonly path: string
    /** The title; with the origin it finds the document again on a rerun. */
    readonly title: string
    /** The topic label shown in the Second Brain. */
    readonly topic: string
    /** Who may read it: customers too (`public`) or the workspace only (`internal`). */
    readonly visibility: SetFactScope
    /** The module that reads it, or null = every module. */
    readonly module: string | null
}

/**
 * ONE seed document (`nivo/set-seed@1`) with TWO uses, told apart by `use` and judged by the document's own content, never by where the file
 * lives:
 * - `test`: a TEST SET (the app repo, stdin, by hand): SANDBOX accounts only (no secret member), invented people and history through the
 *   doors, target `local` only, no documents, no enterprise.
 * - `workspace`: a WORKSPACE SEED from a private `<name>-seed` repo, accepted only with that repo's PINNED commit: one complete workspace
 *   (its plugins, its agents pinned to template + version, its node settings, its accounts sandbox or LIVE with their secret members in the
 *   repo's sealed file, its documents, truths and policy judgements), target `local | prod | both`; foundation only: no people, crowd or pulls.
 */
export interface SetProfile {
    /** The schema name. */
    readonly schema: typeof SET_SEED_SCHEMA
    /** Which of the two uses the document is. */
    readonly use: SetUse
    /** Where it is applied (`local` for every test set). */
    readonly target: SetTarget
    /** The plain name of the set or seed (`set-small-shop`, `blocks-core-seed`); the marker of everything it wrote. */
    readonly name: string
    /** The name of the workspace. */
    readonly workspaceName: string
    /** The name of the existing workspace whose owner also owns this one. */
    readonly ownerWorkspace: string
    /** `workspace`: the document makes and owns the workspace; `overlay`: the workspace exists already and the document only adds to it. */
    readonly kind: "workspace" | "overlay"
    /** The workspace's IANA time zone, or null to keep the platform's default (a door step: the settings door). */
    readonly timeZone: string | null
    /** The language the documents and truths are written in (no workspace store holds a locale: it is the seed's own fact). */
    readonly locale: "vi" | "en"
    /** The enterprise identifier the workspace carries (a private plugin's agents need it), or null. */
    readonly enterprise: string | null
    /** The plugins the workspace needs. */
    readonly plugins: ReadonlyArray<SetPlugin>
    /** The agents, in the order of their front doors. */
    readonly agents: ReadonlyArray<SetAgent>
    /** The accounts. */
    readonly accounts: ReadonlyArray<SetAccount>
    /** The truths written by hand, in order. */
    readonly truths: ReadonlyArray<SetFact>
    /** The generators of truths, as declared (expanded by `expandSetProfile`). */
    readonly generators: ReadonlyArray<unknown>
    /** The documents (a workspace seed only). */
    readonly documents: ReadonlyArray<SetDocument>
    /** The people written for by hand (a test set only). */
    readonly people: ReadonlyArray<SetPerson>
    /** The generator of people, as declared, or null (a test set only). */
    readonly crowd: unknown
    /** The node settings of steps. */
    readonly nodeSettings: ReadonlyArray<SetNodeSetting>
    /** The cases an account's poll reads, in order (a test set only: the people of a mailbox come by its poll, never by a webhook). */
    readonly pulls: ReadonlyArray<SetPull>
}

/** Where a workspace seed came from: its `-seed` repo and the commit it is pinned to (a workspace seed is refused without it). */
export interface SeedOrigin {
    /** The repo's name (`blocks-core-seed`). */
    readonly name: string
    /** The commit, 40 hex digits. */
    readonly commit: string
}

/** One step of the door script: a line said on an account, or a merge of the contacts of one person. */
export type SetDoorStep =
    | {
          readonly kind: "line"
          readonly account: string
          readonly caseId: string
          readonly inputs: Readonly<Record<string, string>>
      }
    | {
          readonly kind: "merge"
          readonly people: ReadonlyArray<{ readonly account: string; readonly id: string }>
      }
    | {
          /** The account's next poll reads this case of its provider's sandbox catalogue (a person's mail the mailbox receives). */
          readonly kind: "pull"
          readonly account: string
          readonly caseId: string
      }

/** What a document comes to once its generators are expanded: pure data, the same bytes on every run. */
export interface SetPlan {
    /** Every truth, in the order they are written. */
    readonly facts: ReadonlyArray<SetFact>
    /** The steps of the door script, in order. */
    readonly doors: ReadonlyArray<SetDoorStep>
}

/** Why one live account of a workspace seed was not written: its secret member is absent, empty, or the sealed file could not be opened. */
export type AccountStop = "secret_missing" | "secret_empty" | "sealed_unreadable"

/** The secret values a run holds IN MEMORY for the live accounts: by account key, by member; or why the sealed file gave none. */
export type SealedValues =
    | { readonly opened: true; readonly accounts: Readonly<Record<string, Readonly<Record<string, string>>>> }
    | { readonly opened: false; readonly reason: string }

/** The texts of the documents a workspace seed names, read from its pinned commit, by path. */
export type DocumentTexts = Readonly<Record<string, string>>

/** The kinds a person may change after a seed; a forced re-seed overwrites a person's change of a kind only when the force names it. */
export type ForceKind = "credentials" | "truths" | "node-settings"

/** The closed list of force kinds. */
export const FORCE_KINDS: ReadonlyArray<ForceKind> = ["credentials", "truths", "node-settings"]
