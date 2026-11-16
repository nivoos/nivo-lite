"use client"

import { useState } from "react"
import { CALLS_PAGE, SANDBOX_LATE_START, type SandboxDeliveryMode } from "@/modules/sandbox"

/** What the person did on the open account that is gone when another account opens. */
interface AccountScoped {
    /** The account the values below belong to. */
    readonly accountId: string | null
    readonly edits: Readonly<Record<string, string>>
    readonly callsShown: number
    readonly isKeyRevealed: boolean
    /** The purpose a next case is picked for; null = every call. */
    readonly scope: string | null
    readonly mode: SandboxDeliveryMode
    readonly lateAmount: number
    readonly lateUnit: string
}

/** What the open account holds that the person changes: the inputs they typed, how much of the log is drawn and whether the key shows. */
export interface SandboxAccountState {
    readonly edits: Readonly<Record<string, string>>
    readonly callsShown: number
    readonly isKeyRevealed: boolean
    /** The purpose a next case is picked for; null = every call. */
    readonly scope: string | null
    readonly setInput: (name: string, value: string) => void
    readonly moreCalls: () => void
    readonly setKeyRevealed: (isRevealed: boolean) => void
    readonly setScope: (scope: string | null) => void
    /** How the next send delivers the event (`once` = as the case says). */
    readonly mode: SandboxDeliveryMode
    /** The interval of `late`: an amount and its unit. */
    readonly lateAmount: number
    readonly lateUnit: string
    readonly setMode: (mode: SandboxDeliveryMode) => void
    readonly setLateAmount: (amount: number) => void
    readonly setLateUnit: (unit: string) => void
}

/** The start of an account: nothing typed, one page of the log, the key hidden, events delivered once. */
const startOf = (accountId: string | null): AccountScoped => ({
    accountId,
    edits: {},
    callsShown: CALLS_PAGE,
    isKeyRevealed: false,
    scope: null,
    mode: "once",
    lateAmount: SANDBOX_LATE_START.amount,
    lateUnit: SANDBOX_LATE_START.unit,
})

/**
 * The per-account state of the page. It belongs to one account: opening another starts it afresh (what was typed for SePay is not
 * sent to Zalo, and a key shown stays on the account it was shown for).
 */
export const useSandboxAccountState = (accountId: string | null): SandboxAccountState => {
    const [state, setState] = useState<AccountScoped>(() => startOf(accountId))
    const current = state.accountId === accountId ? state : startOf(accountId)
    const change = (patch: Partial<Omit<AccountScoped, "accountId">>): void => setState({ ...current, ...patch })
    return {
        edits: current.edits,
        callsShown: current.callsShown,
        isKeyRevealed: current.isKeyRevealed,
        scope: current.scope,
        mode: current.mode,
        lateAmount: current.lateAmount,
        lateUnit: current.lateUnit,
        setMode: (mode) => change({ mode }),
        setLateAmount: (lateAmount) => change({ lateAmount }),
        setLateUnit: (lateUnit) => change({ lateUnit }),
        setInput: (name, value) => change({ edits: { ...current.edits, [name]: value } }),
        moreCalls: () => change({ callsShown: current.callsShown + CALLS_PAGE }),
        setKeyRevealed: (isRevealed) => change({ isKeyRevealed: isRevealed }),
        setScope: (scope) => change({ scope }),
    }
}
