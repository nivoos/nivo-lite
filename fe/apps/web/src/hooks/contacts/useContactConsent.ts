"use client"

import { useTranslations } from "next-intl"
import { useMutateSetContactDoNotContactSwr } from "@/hooks/swr"
import { toast, useGraphQLWithToast } from "@/modules/toast"
import { consentOutcomeKeyOf, refreshContacts } from "./contacts.shared"

/** The one command on the mark that says the agents may not message a person first. */
export interface ContactConsentCommand {
    /** Sets (true) or clears (false) the mark; answers whether it worked. A person who is gone is told so, in a notice. */
    readonly set: (id: string, doNotContact: boolean) => Promise<boolean>
    readonly isPending: boolean
}

/** Sets or clears the "do not message first" mark of a person through the back end (owner or manager), toasted, and reads the people again. */
export const useContactConsent = (): ContactConsentCommand => {
    const t = useTranslations("contacts")
    const run = useGraphQLWithToast()
    const consenting = useMutateSetContactDoNotContactSwr()
    return {
        set: async (id, doNotContact) => {
            const answer = await run(() => consenting.trigger({ contactId: id, doNotContact }), {
                showSuccessToast: false,
            })
            if (answer === undefined) return false
            await refreshContacts()
            if (answer.outcome === "not_found") {
                toast.info(t("consentGone"))
                return false
            }
            toast.success(t(consentOutcomeKeyOf(answer.outcome, doNotContact)))
            return true
        },
        isPending: consenting.isMutating,
    }
}
