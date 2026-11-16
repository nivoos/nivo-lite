import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import { type TemplateAgent, defineTemplateAgent } from "@nivo-lite/agent-sdk/template"
import { webmailText } from "../copy"
import { webmailTeamChatGraph } from "./team-chat.graph"
import { WEBMAIL_TRIAGE_KEY, webmailTriageGraph } from "./triage.graph"

/**
 * The Mailbox agent template: the mail front door (primary) and its chat turn with the team. It works with the mailboxes (a mailbox is ONE
 * account: `smtp` with its inbound half); the front door wakes on a person's mail to an attached mailbox; the team chat needs no account.
 * It holds no send of any kind, no CRM and no money: the agents it hands a mail to answer on the person's route.
 */
export const webmailAgent: TemplateAgent = defineTemplateAgent({
    key: "webmail",
    label: webmailText("agent.label"),
    accounts: [PROVIDER.imap, PROVIDER.smtp],
    graphs: [webmailTriageGraph, webmailTeamChatGraph],
    primary: WEBMAIL_TRIAGE_KEY,
})
