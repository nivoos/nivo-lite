import type {
    AgentGraphLine,
    AgentGraphFlowEdge,
    AgentGraphFlowNode,
    AgentGraphRunStepData,
    AgentGraphPhoneView,
    AgentGraphSideTab,
} from "./agentGraph"

/** The tone of a badge or an alert in the panes. */
export type AgentGraphMark = "neutral" | "accent" | "success" | "warning" | "danger" | "muted"

/** A short mark: a word and its tone. */
export interface AgentGraphBadgeView {
    readonly text: string
    readonly tone: AgentGraphMark
}

/** The band over the graph: what it is and where it stands. */
export interface AgentGraphHeadView {
    readonly title: string
    readonly status: string
    readonly badges: ReadonlyArray<AgentGraphBadgeView>
}

/** The graph itself: its name for assistive technology, the cards, the edges and the selected card. */
export interface AgentGraphCanvasView {
    readonly label: string
    readonly emptyLabel: string
    readonly nodes: ReadonlyArray<AgentGraphFlowNode>
    readonly edges: ReadonlyArray<AgentGraphFlowEdge>
    /** The title of each band, over its column. */
    readonly headers: ReadonlyArray<{ readonly label: string; readonly at: number }>
    readonly selectedId: string
    /** The key under the graph: the role colours and the marks of a wait, the current step and the path taken. */
    readonly legend: ReadonlyArray<AgentGraphLegendItem>
}

/** One entry of the key under the graph: a word and the tone it paints. */
export interface AgentGraphLegendItem {
    readonly id: string
    readonly label: string
    readonly tone: AgentGraphMark
}

/** One answer of the seven, in the shape that draws it. */
export type AgentGraphAnswerView =
    | { readonly id: string; readonly term: string; readonly kind: "text"; readonly text: string }
    | {
          readonly id: string
          readonly term: string
          readonly kind: "lines"
          readonly lines: ReadonlyArray<AgentGraphLine>
      }
    | {
          readonly id: string
          readonly term: string
          readonly kind: "approver"
          readonly name: string
          readonly coverage: string
          readonly timeout: string
      }
    | {
          readonly id: string
          readonly term: string
          readonly kind: "sources"
          readonly sources: ReadonlyArray<{
              readonly id: string
              readonly kindLabel: string
              readonly quote: string
              readonly place: string
          }>
      }

/** A node or a branch with its answers; a branch also says when it is taken. */
export interface AgentGraphDetailView {
    readonly title: string
    readonly badge: string
    readonly subtitle: string
    /** The problems found on this node, in the owner's words; empty when there are none. */
    readonly problemTitle: string
    readonly problems: ReadonlyArray<string>
    readonly answers: ReadonlyArray<AgentGraphAnswerView>
    readonly runsLabel: string
}

/** The problems of the draft in the owner's words, with the step each one is about. */
export interface AgentGraphProblemsView {
    readonly title: string
    readonly items: ReadonlyArray<{
        readonly id: string
        readonly nodeKey: string
        readonly text: string
        readonly isGrant: boolean
    }>
    readonly openLabel: string
    readonly grantLabel: string
    /** "See the other 3", over the problems after the first. */
    readonly moreLabel: string
}

/** A traced run with its steps. */
export interface AgentGraphRunView {
    readonly title: string
    readonly outcome: string
    readonly summary: string
    readonly mismatch: string
    readonly stepsLabel: string
    readonly steps: ReadonlyArray<AgentGraphRunStepData>
    readonly skipped: string
    readonly backLabel: string
}

/** One version of the history. */
export interface AgentGraphVersionView {
    readonly id: string
    readonly title: string
    readonly badge: AgentGraphBadgeView | null
    readonly note: string
    readonly byLine: string
    /** The version that runs now (the draft is never it). */
    readonly isActive: boolean
}

/** The history of the graph. */
export interface AgentGraphVersionsView {
    readonly title: string
    readonly hint: string
    /** "Version 2 · in use": the one chip every surface shows for the version that runs; empty before the first one. */
    readonly activeChip: string
    readonly items: ReadonlyArray<AgentGraphVersionView>
}

/** One branch as a sentence, for the phone. */
export interface AgentGraphBranchRowView {
    readonly id: string
    readonly nodeKey: string
    readonly when: string
    readonly title: string
    readonly line: string
    readonly source: string
    readonly openLabel: string
}

/** The phone list of branches. */
export interface AgentGraphBranchesView {
    readonly title: string
    readonly hint: string
    /** What the list says when no branch is drawn. */
    readonly emptyLabel: string
    readonly rows: ReadonlyArray<AgentGraphBranchRowView>
}

/** Everything the graph panes draw once the graph is in, every word resolved. */
export interface AgentGraphPanelView {
    readonly head: AgentGraphHeadView
    readonly canvas: AgentGraphCanvasView
    readonly sideTab: AgentGraphSideTab
    readonly phoneView: AgentGraphPhoneView
    readonly inspector: "detail" | "run"
    readonly detail: AgentGraphDetailView
    readonly problems: AgentGraphProblemsView
    readonly run: AgentGraphRunView | null
    readonly versions: AgentGraphVersionsView
    readonly branches: AgentGraphBranchesView
    readonly drawerTitle: string
    readonly isDrawerOpen: boolean
}

/** The commands of the graph panes; every argument is an atom. */
export interface AgentGraphCommands {
    readonly select: (nodeKey: string) => void
    readonly sideTab: (value: string) => void
    readonly phoneView: (value: string) => void
    readonly openNode: (nodeKey: string) => void
    readonly closeDrawer: () => void
    readonly trace: () => void
    readonly untrace: () => void
}

/** What a person does on the graph panes, as one action with atoms: the block hands every command through it. */
export type AgentGraphAction =
    | { readonly kind: "select" | "sideTab" | "phoneView" | "openNode"; readonly value: string }
    | { readonly kind: "closeDrawer" | "trace" | "untrace" }
