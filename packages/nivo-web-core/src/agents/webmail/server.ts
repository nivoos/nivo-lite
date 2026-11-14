import type { ModuleServer, ModuleTemplate } from "@nivo-lite/agent-sdk/module"
import { webmailCopy, webmailList, webmailText } from "./copy"
import { WEBMAIL } from "./declaration"

/** The catalogue template of the Mailbox module: its copy, its agent, and its setup gates. */
export const WEBMAIL_TEMPLATE: ModuleTemplate = {
    key: WEBMAIL,
    order: 200,
    name: webmailText("name"),
    shortName: webmailText("shortName"),
    description: webmailText("description"),
    points: webmailList(["points.0", "points.1", "points.2"]),
    purpose: "Hears each new mail a person sends an attached mailbox and tells the team which mails need a person; never writes to a customer.",
    icon: "mail",
    glyph: "M3 6h18v12H3zM3 6l9 7 9-7",
    mascot: "/images/promo/mascot-checklist.png",
    category: "operations",
    status: "early",
    audience: "internal",
    includedWithWorkspace: false,
    available: true,
    knowledgeFolder: WEBMAIL,
    workbench: null,
    settingsExtras: null,
    requires: { capabilities: [], connections: ["smtp"] },
    connectionProviders: ["imap", "smtp"],
    defaultOperatingMode: "assist",
    multiInstance: false,
    agent: {
        label: webmailText("agent.label"),
        handle: WEBMAIL,
        summary: webmailText("agent.summary"),
        capabilities: webmailList(["agent.capabilities.0", "agent.capabilities.1", "agent.capabilities.2", "agent.capabilities.3"]),
        role: webmailText("agent.role"),
        instructions: webmailText("agent.instructions"),
    },
    gates: [
        {
            key: "mailboxes",
            label_vi: webmailCopy("gates.mailboxes.label", "vi"),
            label_en: webmailCopy("gates.mailboxes.label", "en"),
            hint_vi: webmailCopy("gates.mailboxes.hint", "vi"),
            hint_en: webmailCopy("gates.mailboxes.hint", "en"),
        },
        {
            key: "who_takes_mail",
            label_vi: webmailCopy("gates.who.label", "vi"),
            label_en: webmailCopy("gates.who.label", "en"),
            hint_vi: webmailCopy("gates.who.hint", "vi"),
            hint_en: webmailCopy("gates.who.hint", "en"),
        },
    ],
}

/** The server half of the Mailbox module, as the catalogue, the install door and the seed read it. */
export const WEBMAIL_SERVER: ModuleServer = { key: WEBMAIL, template: WEBMAIL_TEMPLATE }
