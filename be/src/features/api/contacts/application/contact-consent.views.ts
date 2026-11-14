import type { ContactConsent } from "@modules/domain/contacts"
import type { ContactConsentView } from "./contact-consent.contracts"
import type { ContactNamesService } from "./contact-names.service"

/** The consent fact as the page reads it: who changed it named by the workspace's members and agents (null names for one that is gone). */
export const consentViewOf = async (
    names: ContactNamesService,
    workspaceId: string,
    consent: ContactConsent,
): Promise<ContactConsentView> => {
    const { by } = consent
    if (by === null) return { doNotContact: consent.doNotContact, at: consent.at, by: null, reason: consent.reason }
    if (by.kind === "member") {
        const members = await names.membersOf([by.memberId])
        return {
            doNotContact: consent.doNotContact,
            at: consent.at,
            by: { kind: "member", id: by.memberId, name: members.get(by.memberId) ?? null, approvedBy: null },
            reason: consent.reason,
        }
    }
    const agents = await names.agentsOf(workspaceId, [by.agentId])
    return {
        doNotContact: consent.doNotContact,
        at: consent.at,
        by: { kind: "agent", id: by.agentId, name: agents.get(by.agentId)?.name ?? null, approvedBy: by.approvedBy },
        reason: consent.reason,
    }
}
