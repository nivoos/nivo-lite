import type { ModuleCopy, RegistryGate } from "@/modules/catalog"
import type { ContextSnapshot, DraftSnapshot, GateEntry, GateEvidence } from "./installations.types"

/** What a module must know before it may act, as its catalogue row declares it. Every gate is required to apply a setup. */
export const gatesOf = (copy: ModuleCopy | undefined): ReadonlyArray<Pick<RegistryGate, "key">> => copy?.gates ?? []

/** Gate state, defaulting to missing. */
export const gateEntry = (evidence: GateEvidence, key: string): GateEntry =>
    evidence[key] ?? { status: "missing", evidence: "" }

/** True when every gate of the module is confirmed. */
export const allGatesConfirmed = (copy: ModuleCopy | undefined, evidence: GateEvidence): boolean =>
    gatesOf(copy).every((gate) => gateEntry(evidence, gate.key).status === "confirmed")

/** The gate title in the reader language. */
export const gateLabel = (gate: RegistryGate, locale: "vi" | "en"): string =>
    locale === "vi" ? gate.label_vi : gate.label_en

/** The gate hint in the reader language. */
export const gateHint = (gate: RegistryGate, locale: "vi" | "en"): string =>
    locale === "vi" ? gate.hint_vi : gate.hint_en

/** What a version would freeze from a draft: summary, facts and the confirmed gates only. */
export const snapshotOf = (draft: DraftSnapshot, gates: GateEvidence): ContextSnapshot => ({
    summary: draft.summary,
    facts: draft.facts,
    gates: Object.fromEntries(Object.entries(gates).filter(([, gate]) => gate.status === "confirmed")),
})
