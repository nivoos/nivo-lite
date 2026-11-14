import type { SandboxPayLinkQuery } from "@/modules/api"
import type {
    SandboxPayData,
    SandboxPayFactView,
    SandboxPayRefusal,
    SandboxPayStatusWords,
    SandboxPayTerms,
} from "@/modules/types"
import type { SandboxWords } from "./sandbox.words"

/** The pay link of the read (never null: the back end refuses a link it does not know). */
type PayLinkWire = SandboxPayLinkQuery["sandboxPayLink"]

/** The typed refusals of the read, by the capability code the back end answers. */
const REFUSAL_BY_CODE: Readonly<Record<string, SandboxPayRefusal>> = {
    PROVIDER_SANDBOX_PAY_LINK_UNKNOWN: "unknown",
    PROVIDER_SANDBOX_LIVE_ACCOUNT: "live",
    PROVIDER_SANDBOX_OFF: "off",
}

/** The refusal a failure code names; undefined for a failure that is not one of the three (the page then shows a failed read). */
export const payRefusalOf = (code: string | undefined): SandboxPayRefusal | undefined =>
    code === undefined ? undefined : REFUSAL_BY_CODE[code]

/** What the page draws for a link the sandbox refuses: no account, no facts, no command. */
export const refusedPayData = (refusal: SandboxPayRefusal): SandboxPayData => ({
    refusal,
    accountId: null,
    facts: [],
    caseId: null,
    inputs: [],
})

/** The words of a link state; a state the page does not know says the generic word, never the raw state. */
const statusOf = (status: string, words: SandboxPayStatusWords): string => {
    if (status === "open" || status === "paid" || status === "cancelled" || status === "expired") return words[status]
    return words.unknown
}

/** What the data of a read link is worded with. */
interface PayDataInput {
    readonly link: PayLinkWire
    readonly words: SandboxWords
    readonly terms: SandboxPayTerms
    readonly status: SandboxPayStatusWords
}

/** The facts of the link: its id, its account, the amount, the content, the order code, its state and, once money came, how much. */
const factsOf = (input: PayDataInput): ReadonlyArray<SandboxPayFactView> => {
    const { link, terms, words } = input
    const received: ReadonlyArray<SandboxPayFactView> =
        link.amountReceivedVnd > 0
            ? [{ id: "received", term: terms.received, value: words.number(link.amountReceivedVnd) }]
            : []
    return [
        { id: "link", term: terms.link, value: link.linkId },
        { id: "account", term: terms.account, value: link.account.label },
        { id: "amount", term: terms.amount, value: words.number(link.amountVnd) },
        { id: "content", term: terms.content, value: link.content },
        { id: "orderCode", term: terms.orderCode, value: link.orderCode },
        { id: "status", term: terms.status, value: statusOf(link.status, input.status) },
        ...received,
    ].filter((fact) => fact.value !== "")
}

/** What the primary command sends: the link's own account, its first case and the inputs the link gives; null while there is none to send (not read, refused, or the link is closed). */
export const payTargetOf = (
    data: SandboxPayData | undefined,
): { readonly accountId: string; readonly caseId: string; readonly inputs: SandboxPayData["inputs"] } | null => {
    if (data === undefined) return null
    const { accountId, caseId } = data
    return accountId === null || caseId === null ? null : { accountId, caseId, inputs: data.inputs }
}

/** What the page draws once the link is read: the facts, the account it acts through and the first case that applies (none once the link is closed). */
export const payDataOf = (input: PayDataInput): SandboxPayData => ({
    refusal: null,
    accountId: input.link.account.id,
    facts: factsOf(input),
    caseId: input.link.caseIds[0] ?? null,
    inputs: input.link.inputs.map((one) => ({ name: one.name, value: one.value })),
})
