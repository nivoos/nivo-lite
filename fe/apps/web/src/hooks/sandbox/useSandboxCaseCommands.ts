"use client"

import { useTranslations } from "next-intl"
import { useState } from "react"
import {
    QUERY_SANDBOX_CALLS_SWR_KEY,
    QUERY_SANDBOX_LATEST_REQUEST_SWR_KEY,
    QUERY_SANDBOX_NEXT_CASES_SWR_KEY,
    QUERY_SANDBOX_WAITING_RUNS_SWR_KEY,
    useMutateSendSandboxCaseSwr,
    useMutateSetSandboxNextCaseSwr,
    useMutateSetSandboxNextOutcomeSwr,
} from "@/hooks/swr"
import type { SandboxDeliveryMode } from "@/modules/sandbox"
import { toast, useGraphQLWithToast } from "@/modules/toast"
import { modeNamesOf, outcomeNamesOf, wordOf } from "./sandbox.names"
import { refreshSandbox } from "./sandbox.shared"

/** The lowest status a webhook answers when it refused what the page sent. */
const REFUSED_FROM = 400

/** What a send takes: the case and the inputs the person filled (an input left empty is left out, so the back end prefills it). */
interface SendInput {
    readonly connectionId: string
    readonly caseId: string
    /** How the event is delivered; absent: as the case says (once, unless the case is itself a name for a mode). */
    readonly mode?: SandboxDeliveryMode
    /** The interval of `late`, in seconds. */
    readonly lateBySeconds?: number
    readonly inputs: ReadonlyArray<{ readonly name: string; readonly value: string }>
}

/** The commands on the cases of an account: send an inbound one, choose the next outbound one, set the next outcome of an operation. */
export interface SandboxCaseCommands {
    readonly send: (input: SendInput) => Promise<boolean>
    /** Picks the next case: for every call, or, with a `scope`, for that purpose only. */
    readonly choose: (connectionId: string, caseId: string, scope?: string) => Promise<boolean>
    /** Sets the outcome of the next outbound calls of an operation; sticky until changed (`ok` is the way back). */
    readonly setOutcome: (connectionId: string, operation: string, outcome: string) => Promise<boolean>
    /** The case being sent, or chosen; null when none is. */
    readonly sendingId: string | null
    readonly choosingId: string | null
    /** The operation whose outcome is being set; null when none is. */
    readonly outcomeOperation: string | null
}

/** Sends cases and chooses next cases through the back end, toasted in plain words; a webhook that refused the send is named in a warning. */
export const useSandboxCaseCommands = (): SandboxCaseCommands => {
    const t = useTranslations("sandbox")
    const tToast = useTranslations("toast")
    const run = useGraphQLWithToast()
    const sending = useMutateSendSandboxCaseSwr()
    const choosing = useMutateSetSandboxNextCaseSwr()
    const setting = useMutateSetSandboxNextOutcomeSwr()
    const [sendingId, setSendingId] = useState<string | null>(null)
    const [choosingId, setChoosingId] = useState<string | null>(null)
    const [outcomeOperation, setOutcomeOperation] = useState<string | null>(null)
    return {
        send: async (input) => {
            setSendingId(input.caseId)
            try {
                const answer = await run(() => sending.trigger({ ...input, inputs: [...input.inputs] }), {
                    showSuccessToast: false,
                })
                if (answer === undefined) return false
                // The line that says which mode the event went in, so a "once" send is told from a "twice" or a "late" one.
                toast.success(tToast("successTitle"), {
                    description: `${t("toastSent", { id: input.caseId })} · ${wordOf(modeNamesOf(t), answer.mode)}${
                        answer.mode === "late" ? ` (${t("toastLateBy", { seconds: answer.lateBySeconds })})` : ""
                    }`,
                })
                const refused = answer.deliveries.find((delivery) => delivery.status >= REFUSED_FROM)
                if (answer.mode === "withheld") toast.warning(t("toastWebhookDropped"))
                if (refused !== undefined) {
                    toast.warning(t("toastRefused", { status: refused.status, path: refused.path }))
                }
                await refreshSandbox(
                    QUERY_SANDBOX_CALLS_SWR_KEY,
                    QUERY_SANDBOX_LATEST_REQUEST_SWR_KEY,
                    QUERY_SANDBOX_WAITING_RUNS_SWR_KEY,
                )
                return true
            } finally {
                setSendingId(null)
            }
        },
        choose: async (connectionId, caseId, scope) => {
            setChoosingId(caseId)
            try {
                const answer = await run(() => choosing.trigger({ connectionId, caseId, ...(scope === undefined ? {} : { scope }) }), {
                    successMessage: t("toastChosen", { id: caseId }),
                })
                if (answer === undefined) return false
                await refreshSandbox(QUERY_SANDBOX_NEXT_CASES_SWR_KEY)
                return true
            } finally {
                setChoosingId(null)
            }
        },
        setOutcome: async (connectionId, operation, outcome) => {
            setOutcomeOperation(operation)
            try {
                const answer = await run(() => setting.trigger({ connectionId, operation, outcome }), {
                    successMessage: t("toastOutcome", { operation, outcome: wordOf(outcomeNamesOf(t), outcome) }),
                })
                if (answer === undefined) return false
                await refreshSandbox(QUERY_SANDBOX_NEXT_CASES_SWR_KEY)
                return true
            } finally {
                setOutcomeOperation(null)
            }
        },
        sendingId,
        choosingId,
        outcomeOperation,
    }
}
