"use client"

import { useCallback } from "react"
import { useConnectionsRole } from "@/hooks/connections"
import type { StepSettingsWrite } from "./useStepSettingsWrite"

/** The write of the account choice. */
export interface StepAccountChoice {
    /** Writes the step using exactly these accounts, in this order (empty: the agent's default). */
    readonly choose: (ids: ReadonlyArray<string>) => void
    readonly isPending: boolean
    /** Only the shop's owner changes the choice. */
    readonly isOwner: boolean
}

/** Which accounts the open step uses (a setting of the node, as its mode is): ONE `setAgentNodeSettings` call with `accountIds`. */
export const useStepAccountChoice = (write: StepSettingsWrite, isFrozen: boolean): StepAccountChoice => {
    const isOwner = useConnectionsRole().role === "owner"
    const choose = useCallback(
        (ids: ReadonlyArray<string>) => {
            if (!isOwner || isFrozen) return
            write.write({ accountIds: ids })
        },
        [isOwner, isFrozen, write],
    )
    return { choose, isPending: write.isPending, isOwner }
}
