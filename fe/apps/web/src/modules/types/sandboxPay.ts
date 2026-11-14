import type { DataSlot, SlotLabels } from "./slot"
import type { SandboxGate } from "./sandbox"

/** Why the sandbox refuses to show a pay link: it was never issued here, it belongs to a live account, or the sandbox is switched off. */
export type SandboxPayRefusal = "unknown" | "live" | "off"

/** The title and the sentence of one neutral notice. */
interface SandboxPayNoticeCopy {
    readonly title: string
    readonly body: string
}

/** The words of the sandbox pay page, resolved once by the connected half (the pure half holds no copy). */
export interface SandboxPayCopy {
    readonly title: string
    /** The one sentence that says no money moves. */
    readonly description: string
    /** The words of the page's one primary command: the "paid in full" case. */
    readonly paidLabel: string
    readonly offTitle: string
    readonly offBody: string
    readonly staffTitle: string
    readonly staffBody: string
    readonly failTitle: string
    readonly failBody: string
    readonly retryLabel: string
    readonly request: {
        readonly title: string
        readonly errorTitle: string
    }
    /** The notices of the link the sandbox refuses; the switch that is off says what the Sandbox page says. */
    readonly refusals: Readonly<Record<Exclude<SandboxPayRefusal, "off">, SandboxPayNoticeCopy>>
}

/** The terms of the facts of one pay link. */
export interface SandboxPayTerms {
    readonly link: string
    readonly account: string
    /** "Amount (VND)". */
    readonly amount: string
    readonly content: string
    readonly orderCode: string
    readonly status: string
    readonly received: string
}

/** The words of the state of a link, by the state the back end answers; `unknown` for a state the page has no word for. */
export interface SandboxPayStatusWords {
    readonly open: string
    readonly paid: string
    readonly cancelled: string
    readonly expired: string
    readonly unknown: string
}

/** One fact of the payment request: a term and its value. */
export interface SandboxPayFactView {
    readonly id: string
    readonly term: string
    readonly value: string
}

/** The link as the page draws it and acts on it. */
export interface SandboxPayData {
    /** Why the sandbox does not show the link; null for a link that is read. */
    readonly refusal: SandboxPayRefusal | null
    /** The sandbox account the link belongs to: the page acts through it; null for a refused link. */
    readonly accountId: string | null
    readonly facts: ReadonlyArray<SandboxPayFactView>
    /** The case of the page's one primary command (the first of the cases that apply); null once the link is paid, cancelled or expired. */
    readonly caseId: string | null
    /** What the link gives the case's inputs (for payOS the order code): they travel with the send. */
    readonly inputs: ReadonlyArray<{ readonly name: string; readonly value: string }>
}

/** What the sandbox pay page draws and does. */
export interface SandboxPayPanesBaseProps {
    readonly props: {
        readonly copy: SandboxPayCopy
        /** The words of the slot notices (loading failed, empty, forbidden). */
        readonly slotLabels: SlotLabels
        readonly gate: SandboxGate
        readonly data: DataSlot<SandboxPayData>
        /** The case being sent; null when none is. */
        readonly sendingId: string | null
    }
    readonly on: {
        readonly retryGate: () => void
        readonly retryData: () => void
        /** Sends the case the link names, through the link's own account. */
        readonly send: () => void
    }
}
