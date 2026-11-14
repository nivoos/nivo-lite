"use client"

import { useTranslations } from "next-intl"
import { loadingSlot, slotOfSwr, useSlotLabels } from "@/hooks/slot"
import { useQuerySandboxPayLinkSwr } from "@/hooks/swr"
import { graphQLErrorCode } from "@/modules/failure"
import { payDataOf, payRefusalOf, payTargetOf, refusedPayData } from "@/modules/sandbox"
import type {
    DataSlot,
    SandboxPayCopy,
    SandboxPayData,
    SandboxPayPanesBaseProps,
    SandboxPayStatusWords,
    SandboxPayTerms,
} from "@/modules/types"
import { useSandboxCaseCommands } from "./useSandboxCaseCommands"
import { useSandboxCopy } from "./useSandboxCopy"
import { useSandboxGate } from "./useSandboxGate"

/** A reader of the `sandbox` catalog. */
type Say = ReturnType<typeof useTranslations<"sandbox">>

/** The words of the pay page: its header, the notices of the gate and of a refused link, and its one card. */
const payCopyOf = (t: Say, retryLabel: string): SandboxPayCopy => ({
    title: t("payTitle"),
    description: t("payDescription"),
    paidLabel: t("payPaidLabel"),
    offTitle: t("offTitle"),
    offBody: t("offBody"),
    staffTitle: t("staffTitle"),
    staffBody: t("staffBody"),
    failTitle: t("failTitle"),
    failBody: t("failBody"),
    retryLabel,
    request: { title: t("payRequestTitle"), errorTitle: t("payRequestError") },
    refusals: {
        unknown: { title: t("payUnknownTitle"), body: t("payUnknownBody") },
        live: { title: t("payLiveTitle"), body: t("payLiveBody") },
    },
})

/** The terms of the facts of the link. */
const termsOf = (t: Say): SandboxPayTerms => ({
    link: t("payLinkTerm"),
    account: t("payAccountTerm"),
    amount: t("payAmountTerm"),
    content: t("payContentTerm"),
    orderCode: t("payOrderCodeTerm"),
    status: t("payStatusTerm"),
    received: t("payReceivedTerm"),
})

/** The words of the state of the link. */
const statusWordsOf = (t: Say): SandboxPayStatusWords => ({
    open: t("payStatusOpen"),
    paid: t("payStatusPaid"),
    cancelled: t("payStatusCancelled"),
    expired: t("payStatusExpired"),
    unknown: t("payStatusUnknown"),
})

/**
 * The whole view of the sandbox pay page of one link: the same gate as the Sandbox page, then ONE read of the link (its account,
 * amount, content, order code, state and the cases that apply). The primary command sends the first case through the link's own
 * account and reads the link again, so a paid link shows paid. A refusal of the read (unknown link, live account, switch off) is a
 * neutral state of the page, not a failure.
 */
export const useSandboxPayView = (linkId: string): SandboxPayPanesBaseProps => {
    const t = useTranslations("sandbox")
    const labelsOf = useSlotLabels()
    const shell = useTranslations("shell")
    const { words } = useSandboxCopy()
    const { gate, retry: retryGate } = useSandboxGate()
    const commands = useSandboxCaseCommands()
    const copy = payCopyOf(t, shell("retry"))
    const read = useQuerySandboxPayLinkSwr(gate === "on" && linkId !== "" ? linkId : undefined)
    const refusal = payRefusalOf(graphQLErrorCode(read.error))
    const link = read.data
    const data: DataSlot<SandboxPayData> =
        refusal === undefined
            ? slotOfSwr<SandboxPayData>({
                  data: link === undefined ? undefined : payDataOf({ link, words, terms: termsOf(t), status: statusWordsOf(t) }),
                  error: read.error,
                  isLoading: read.isLoading,
                  isValidating: read.isValidating,
              })
            : { items: refusedPayData(refusal) }
    const target = payTargetOf("items" in data ? data.items : undefined)
    return {
        props: {
            copy,
            slotLabels: labelsOf(copy.request.errorTitle),
            gate,
            data: gate === "checking" ? loadingSlot() : data,
            sendingId: commands.sendingId,
        },
        on: {
            retryGate,
            retryData: () => void read.mutate(),
            send: () => {
                if (target === null) return
                void commands
                    .send({ connectionId: target.accountId, caseId: target.caseId, inputs: [...target.inputs] })
                    .then(() => read.mutate())
            },
        },
    }
}
