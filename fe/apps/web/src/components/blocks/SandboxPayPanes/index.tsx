"use client"

import { useSandboxPayView } from "@/hooks/sandbox"
import { SandboxPayPanesBase } from "./component"

/** What the route hands the block: the pay link of the address. */
interface SandboxPayPanesProps {
    readonly linkId: string
}

/** Reads the PayOS sandbox account, its payment cases and the agent's latest request, words them and builds the commands; the pure half draws the page. */
export const SandboxPayPanes = (props: SandboxPayPanesProps) => {
    const view = useSandboxPayView(props.linkId)
    return <SandboxPayPanesBase props={view.props} on={view.on} />
}
