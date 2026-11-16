"use client"

import { useState, useSyncExternalStore } from "react"
import type { AgentGraphUi } from "@/modules/agent-graph"
import type { AgentGraphPhoneView, AgentGraphSideTab } from "@/modules/types"
import { PHONE_VIEWS, SIDE_TABS } from "./agentGraph.shared"

/** From this width the pane beside the graph shows next to it; under it the detail of a node opens in a drawer. */
const SIDE_BY_SIDE_QUERY = "(min-width: 48rem)"

const subscribeSideBySide = (notify: () => void): (() => void) => {
    const query = window.matchMedia(SIDE_BY_SIDE_QUERY)
    query.addEventListener("change", notify)
    return () => query.removeEventListener("change", notify)
}

const readSideBySide = (): boolean => window.matchMedia(SIDE_BY_SIDE_QUERY).matches

const readSideBySideOnServer = (): boolean => true

/** Which tab of the pane beside the graph shows and which view the phone shows. */
interface Tabs {
    readonly sideTab: AgentGraphSideTab
    readonly phoneView: AgentGraphPhoneView
}

/** The view `useAgentGraphUi` returns. */
export interface AgentGraphUiView {
    ui: AgentGraphUi
    select: (key: string) => void
    openNode: (key: string) => void
    closeDrawer: () => void
    sideTab: (value: string) => void
    phoneView: (value: string) => void
    trace: (id: string) => void
    untrace: () => void
}

/** The choices a person makes on the graph panes that are not data: what is selected, which tab shows, what is traced. */
export const useAgentGraphUi = (initialRunId: string): AgentGraphUiView => {
    const [selectedKey, setSelectedKey] = useState("")
    const [tabs, setTabs] = useState<Tabs>({ sideTab: "chat", phoneView: "checklist" })
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)
    const [runId, setRunId] = useState(initialRunId)
    const isSideBySide = useSyncExternalStore(subscribeSideBySide, readSideBySide, readSideBySideOnServer)
    const ui: AgentGraphUi = {
        selectedKey,
        sideTab: tabs.sideTab,
        phoneView: tabs.phoneView,
        isDrawerOpen,
        runId,
    }
    const showSideTab = (sideTab: AgentGraphSideTab) => setTabs((current) => ({ ...current, sideTab }))
    const select = (key: string) => {
        setSelectedKey(key)
        if (key !== "") showSideTab("detail")
    }
    return {
        ui,
        select,
        openNode: (key: string) => {
            select(key)
            setIsDrawerOpen(!isSideBySide)
        },
        closeDrawer: () => setIsDrawerOpen(false),
        sideTab: (value: string) => showSideTab(SIDE_TABS.find((tab) => tab === value) ?? "chat"),
        phoneView: (value: string) => {
            const view = PHONE_VIEWS.find((entry) => entry === value) ?? "checklist"
            setTabs((current) => ({ phoneView: view, sideTab: view === "chat" ? view : current.sideTab }))
        },
        trace: (id: string) => {
            setRunId(id)
            showSideTab("detail")
        },
        untrace: () => setRunId(""),
    }
}
