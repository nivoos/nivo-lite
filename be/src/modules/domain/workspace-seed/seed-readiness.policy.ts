import { crmIdOfProviderKey } from "@nivo-lite/agent-sdk/names"
import type { InstalledPlugin } from "@nivo-lite/agent-sdk/installation"
import { latestTemplateVersion, templateVersionOf, type WorkflowTemplate } from "@nivo-lite/agent-sdk/template"
import type { EnterpriseSeedPlace } from "@modules/domain/channel-provisioning"
import type { SealedValues, SetAccount, SetProfile } from "./set-seed.contracts"

/** The provider key of a CRM account: an OpenAPI account whose `summary` names the CRM (the CRM connect door's own facts). */
const OPENAPI = "openapi"

/** What the readiness rule reads of the installation: only what the plugins DECLARE (no list per plugin). */
export interface ReadinessInstalled {
    /** The installed plugins, each with the version of its package when the caller can read it (null: not judged). */
    readonly plugins: ReadonlyArray<Pick<InstalledPlugin, "key" | "visibility" | "enterprises" | "modules"> & { readonly version: string | null }>
    /** Every workflow template of a module (its graphs, as the engine installs them). */
    readonly templatesOf: (moduleKey: string) => ReadonlyArray<WorkflowTemplate>
    /** The customer channels a module's agent is the front door of (its graphs' customer-message triggers). */
    readonly inboundChannelsOf: (moduleKey: string) => ReadonlySet<string>
}

/** Where each secret member of each live account stands, by NAME only: `set` or `empty` (a value is never read here); null = not known. */
export type SealedNames = Readonly<Record<string, Readonly<Record<string, "set" | "empty">>>> | null

/** The names of a sealed file the applier opened, as the readiness rule reads them (values dropped at once). */
export const sealedNamesOf = (sealed: SealedValues | null): SealedNames =>
    sealed === null || !sealed.opened
        ? null
        : Object.fromEntries(
              Object.entries(sealed.accounts).map(([key, members]) => [
                  key,
                  Object.fromEntries(Object.entries(members).map(([member, value]) => [member, value === "" ? "empty" : "set"])),
              ]),
          )

/** True when an account of the seed answers for a provider key a node step lists (a CRM key is an OpenAPI account of that CRM). */
export const covers = (account: SetAccount, providerKey: string): boolean => {
    if (account.provider === providerKey) return true
    const crmId = crmIdOfProviderKey(providerKey)
    return crmId !== null && account.provider === OPENAPI && account.facts.summary === crmId
}

/**
 * THE MEANING OF "COMPLETE" (R100: one apply = a workspace that can operate at once), as a list this rule enforces, each item DERIVED from
 * what the installed plugins declare (their templates' node steps, accounts and triggers), never from a list per plugin:
 * 1. a human owner is named (`ownerWorkspace`: the workspace's owner is that workspace's owner);
 * 2. every plugin named is installed (at the named version when the version is known), a private one opens to the seed's enterprise;
 * 3. every agent's module belongs to a plugin the seed names, and names its PRIMARY template at a version the installation holds;
 * 4. every node setting names a node of a template of that module; its accounts are accounts of the seed whose provider that node lists;
 * 5. every node step of an agent's templates that lists accounts has a USABLE account of ONE of the providers it lists: a live one whose
 *    secret members are all set, or, on the local stack only, a sandbox one (production never attaches a sandbox account) - so a graph
 *    that takes payments has a bank account, a graph that writes mail a mailbox;
 * 6. when an agent is the front door of a customer channel, the seed holds a usable account of at least one such channel (an entrance);
 * 7. the agents have knowledge to answer from: at least one document or one truth;
 * 8. every live account names its secret members and each EXISTS in the sealed file (by name; never decrypted).
 * Answers what is missing, one line each; empty = READY.
 */
export const readinessOf = (
    profile: SetProfile,
    installed: ReadinessInstalled,
    sealed: SealedNames,
    place: EnterpriseSeedPlace,
): ReadonlyArray<string> => {
    const missing: Array<string> = []
    if (profile.ownerWorkspace.trim() === "") missing.push("owner: no owner workspace named")
    for (const plugin of profile.plugins) {
        const found = installed.plugins.find((one) => one.key === plugin.key)
        if (found === undefined) missing.push(`plugin ${plugin.key}: not installed`)
        else if (found.version !== null && found.version !== plugin.version) missing.push(`plugin ${plugin.key}: installed ${found.version}, seed names ${plugin.version}`)
        else if (found.visibility === "private" && (profile.enterprise === null || !found.enterprises.includes(profile.enterprise))) {
            missing.push(`plugin ${plugin.key}: private, the seed's enterprise is not one it opens to`)
        }
    }
    const usable = (account: SetAccount): boolean => {
        if (account.sandbox) return place === "local"
        const names = sealed?.[account.key]
        return names !== undefined && account.secrets.every((member) => names[member] === "set")
    }
    for (const account of profile.accounts.filter((one) => !one.sandbox)) {
        for (const member of account.secrets) {
            const state = sealed === null ? "unknown" : (sealed[account.key]?.[member] ?? "missing")
            if (state === "missing" || state === "unknown") missing.push(`account ${account.key}: secret member ${member} ${state === "missing" ? "absent from" : "not readable in"} the sealed file`)
        }
    }
    for (const agent of profile.agents) {
        const plugin = installed.plugins.find((one) => one.modules.includes(agent.module))
        if (plugin === undefined || !profile.plugins.some((one) => one.key === plugin.key)) missing.push(`agent ${agent.module}: its plugin is not named by the seed`)
        const templates = installed.templatesOf(agent.module)
        if (agent.template !== null) {
            const template = templates.find((one) => one.id === agent.template && one.primary)
            if (template === undefined) missing.push(`agent ${agent.module}: template ${agent.template} is not its installed primary template`)
            else if (templateVersionOf(template, agent.version ?? 0) === null) missing.push(`agent ${agent.module}: template ${agent.template} has no version ${String(agent.version)}`)
        }
        const unmet = new Map<string, Array<string>>()
        for (const template of templates) {
            for (const node of latestTemplateVersion(template).graph.nodes) {
                const providers = [...new Set((node.accounts ?? []).flatMap((entry) => (entry.provider === null ? [] : [entry.provider])))].toSorted()
                if (providers.length === 0) continue
                if (profile.accounts.some((account) => providers.some((provider) => covers(account, provider)) && usable(account))) continue
                const need = providers.join(" | ")
                unmet.set(need, [...(unmet.get(need) ?? []), `${template.id}/${node.key}`])
            }
        }
        for (const [need, steps] of unmet) missing.push(`agent ${agent.module}: no usable account of [${need}] (needed by ${steps.join(", ")})`)
        const entrances = installed.inboundChannelsOf(agent.module)
        if (entrances.size > 0 && !profile.accounts.some((account) => [...entrances].some((channel) => covers(account, channel)) && usable(account))) {
            missing.push(`agent ${agent.module}: front door of [${[...entrances].join(", ")}] but no usable entrance account`)
        }
    }
    for (const setting of profile.nodeSettings) {
        const node = installed
            .templatesOf(setting.module)
            .filter((template) => template.id === setting.workflow)
            .flatMap((template) => latestTemplateVersion(template).graph.nodes)
            .find((one) => one.key === setting.node)
        if (node === undefined) {
            missing.push(`node setting ${setting.workflow}/${setting.node}: no such node in the installed template`)
            continue
        }
        const accepts = (node.accounts ?? []).flatMap((entry) => (entry.provider === null ? [] : [entry.provider]))
        for (const key of setting.accounts ?? []) {
            const account = profile.accounts.find((one) => one.key === key)
            if (account === undefined || !accepts.some((provider) => covers(account, provider))) {
                missing.push(`node setting ${setting.workflow}/${setting.node}: account ${key} is of no provider the node lists [${accepts.join(", ")}]`)
            }
        }
    }
    if (profile.agents.length > 0 && profile.documents.length === 0 && profile.truths.length === 0 && profile.generators.length === 0) {
        missing.push("knowledge: no document and no truth for the agents to answer from")
    }
    return missing
}

/** The one line a dry run and the check print: READY yes, or no with what is missing. */
export const readyLineOf = (name: string, missing: ReadonlyArray<string>): string =>
    missing.length === 0 ? `${name}: READY: yes` : `${name}: READY: no (${String(missing.length)} missing): ${missing.join("; ")}`
