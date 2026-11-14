/** The four kinds of node, the four bands of the screen from left to right: what starts the work, what is done, the condition that picks a branch, what comes out. */
export type AgentGraphNodeKind = "trigger" | "execute" | "condition" | "output"

/** Who works a node: the model only ever works an `understand` node. */
export type AgentGraphDoneBy = "agent" | "nivo" | "person"

/** What a branch does: run alone, ask the approver, or stop. */
export type AgentGraphBranchMode = "auto" | "ask" | "stop"

/** What happens when nobody answers in time; `unset` is a draft that is not finished and cannot be published. */
export type AgentGraphOnTimeout = "backup" | "stop" | "agent_owner" | "unset"

/** The kind of rule behind a node or a branch. */
export type AgentGraphSourceKind = "brain" | "template" | "chat" | "learned" | "owner" | "rule" | "corrected"

/** The tone of a card on the graph. */
export type AgentGraphTone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted"

/** The outline of a card on the graph. */
export type AgentGraphShape = "rect" | "round" | "diamond" | "stadium"

/** The areas and row tracks of the Setup grid on a phone and on a laptop, for the tab and the view in use. */
export interface AgentGraphLayoutView {
    readonly phoneAreas: ReadonlyArray<string>
    readonly phoneRows: ReadonlyArray<"auto" | "fill">
    readonly mediumAreas: ReadonlyArray<string>
    readonly mediumRows: ReadonlyArray<"auto" | "fill">
}

/** The tabs of the pane beside the graph. */
export type AgentGraphSideTab = "chat" | "detail"

/** The views the phone offers in place of two panes: what must be done before it runs, the map as branches and the chat. */
export type AgentGraphPhoneView = "checklist" | "graph" | "chat"

/** One line of a list answer: the owner's words and, under them, the technical name. */
export interface AgentGraphLine {
    readonly label: string
    readonly note: string
}

/** The rule behind a node or a branch, as a quote and the place it was said or written. */
export interface AgentGraphSourceData {
    readonly kind: AgentGraphSourceKind
    readonly quote: string
    readonly place: string
}

/** Who is asked, how long they have and who takes over, every name resolved by the back end from the workspace. */
export interface AgentGraphApproverData {
    readonly memberId: string
    readonly name: string
    /** "Can approve up to 20,000,000", in the owner's words. */
    readonly coverage: string
    readonly timeoutMinutes: number
    readonly onTimeout: AgentGraphOnTimeout
    readonly backupId: string
    readonly backupName: string
}

/** One branch of a decide point: the sentence of its condition and what it does. */
export interface AgentGraphBranchData {
    readonly key: string
    /** "from 5 million to under 20 million": short, for the edge of the map, in the language of the reader. */
    readonly when: string
    /** The same with the name of the fact, "the order amount from 5 million to under 20 million". */
    readonly whenFull: string
    readonly mode: AgentGraphBranchMode
    /** The node the branch goes to. */
    readonly next: string
    readonly approver: AgentGraphApproverData | null
    readonly sources: ReadonlyArray<AgentGraphSourceData>
    readonly selfCorrected: boolean
}

/** What a node looks like at a glance. */
export interface AgentGraphCardData {
    /** At most 36 characters: "SePay · Dinh approves". */
    readonly description: string
    readonly tone: AgentGraphTone
    readonly shape: AgentGraphShape
    /** The word of the rule behind it: Brain, Template, Chat, Learned, Self-corrected. */
    readonly count: string
    readonly isPlaceholder: boolean
    /** The sub-flow the node belongs to ("consult", "care"), or empty for a node on its own. */
    readonly group: string
    /** What the node waits for and how long; null for a node that does not wait. */
    readonly wait: AgentGraphWaitData | null
}

/** What a waiting node waits for: the customer's reply, a payment or something else, with the timeout and reminder as durations ("2h"). */
export interface AgentGraphWaitData {
    readonly kind: "reply" | "payment" | "other"
    readonly timeout: string
    readonly reminder: string
}

/** One node with its seven answers, none of them blank: "None" is an answer. */
export interface AgentGraphNodeData {
    readonly key: string
    readonly kind: AgentGraphNodeKind
    readonly title: string
    readonly doneBy: AgentGraphDoneBy
    readonly card: AgentGraphCardData
    readonly knows: ReadonlyArray<AgentGraphLine>
    readonly does: string
    readonly uses: ReadonlyArray<AgentGraphLine>
    readonly reads: ReadonlyArray<AgentGraphLine>
    readonly writes: ReadonlyArray<AgentGraphLine>
    readonly approver: AgentGraphApproverData | null
    readonly sources: ReadonlyArray<AgentGraphSourceData>
    /** The nodes that follow; a decide node names its followers in its branches. */
    readonly next: ReadonlyArray<string>
    /** What a decide node asks, "Real amount?"; empty on the other kinds. */
    readonly intent: string
    readonly branches: ReadonlyArray<AgentGraphBranchData>
}

/** One saved version of the graph as the owner lists it. */
export interface AgentGraphVersionData {
    readonly id: string
    readonly version: number
    readonly note: string
    /** "Chat, 28/10 09:12", already in the words of the reader. */
    readonly byLine: string
    readonly runs: number
    readonly isActive: boolean
}

/** One comparison of a condition as the page reads it: a fact, how it is compared, and the value. */
export interface AgentGraphTermForm {
    readonly fact: string
    readonly op: AgentGraphOp
    /** The value of a number fact. */
    readonly amount: number
    /** The value of any other fact; for "is one of", the values apart by commas. */
    readonly text: string
}

/** One step of a traced run. */
export interface AgentGraphRunStepData {
    readonly id: string
    readonly time: string
    readonly text: string
    readonly note: string
}

/** One run traced on the version that decided it. */
export interface AgentGraphRunData {
    readonly id: string
    readonly title: string
    readonly summary: string
    readonly outcome: string
    /** "The model proposed 4.9M, the books say 7.2M. NIVO follows the books.", or empty. */
    readonly mismatch: string
    readonly steps: ReadonlyArray<AgentGraphRunStepData>
    /** The node keys on the path, in order. */
    readonly path: ReadonlyArray<string>
    /** The node that did not run and why. */
    readonly skipped: string
}

/** A person who may be asked, and the top of the amount they may approve. */
export interface AgentGraphMemberData {
    readonly id: string
    readonly name: string
    /** Null when the right has no top. */
    readonly upToVnd: number | null
}

/** One problem the checks found in the draft: its code, where it is, and the words the back end kept to name what is wrong. */
export interface AgentGraphProblemData {
    readonly code: string
    readonly nodeKey: string
    /** The branch it is about; empty when it is about the node. */
    readonly branchKey: string
    readonly detail: string
}

/** One thing the setup chat still has to ask: its code and where it is. */
export interface AgentGraphGapData {
    readonly code: string
    readonly nodeKey: string
    readonly branchKey: string
}

/** What a condition compares a fact with. */
export type AgentGraphOp = "lt" | "lte" | "gt" | "gte" | "eq" | "neq" | "in" | "known"

/** One fact a condition may be written on, with its words. */
export interface AgentGraphFactData {
    readonly key: string
    readonly label: string
    readonly type: "number" | "string" | "boolean"
    readonly unit: "vnd" | "percent" | "count" | null
    /** The values it may hold, for a fact that is one of a few; empty for any. */
    readonly allowed: ReadonlyArray<string>
}

/** The graph of one agent as the page reads it (read only: a shop never edits a graph). */
export interface AgentGraphData {
    readonly activeVersion: number
    readonly gaps: ReadonlyArray<AgentGraphGapData>
    readonly problems: ReadonlyArray<AgentGraphProblemData>
    readonly nodes: ReadonlyArray<AgentGraphNodeData>
    readonly versions: ReadonlyArray<AgentGraphVersionData>
    readonly runs: ReadonlyArray<AgentGraphRunData>
    readonly members: ReadonlyArray<AgentGraphMemberData>
    /** The facts a condition may be written on. */
    readonly facts: ReadonlyArray<AgentGraphFactData>
}

/** A node as the graph draws it at a glance, in the shape the graph component takes. */
export interface AgentGraphFlowNode {
    readonly id: string
    readonly label: string
    readonly description: string
    /** What the step is: the lanes layout sets its tone and its row from it. */
    readonly kind: AgentGraphNodeKind
    readonly tone: AgentGraphTone
    readonly shape: AgentGraphShape
    readonly count: string
    readonly isPlaceholder: boolean
    /** True while a run is traced and this step is not on its path. */
    readonly isDimmed: boolean
}

/** An edge of the graph; a branch of a decide node reads its condition on the edge. */
export interface AgentGraphFlowEdge {
    readonly id: string
    readonly source: string
    readonly target: string
    readonly label?: string
}

/** What paints the graph: the selected node, or the path of a traced run. */
export interface AgentGraphPaint {
    readonly selectedKey: string
    readonly path: ReadonlyArray<string>
}

/** The branch a node is the answer of, with the decide node that asks. */
export interface AgentGraphBranchHit {
    readonly parent: AgentGraphNodeData
    readonly branch: AgentGraphBranchData
    readonly position: number
}

/** How the right of an approver reads against the top of a branch. */
export type AgentGraphRight = "none" | "missing" | "covers" | "short"

/** The words a change to the draft needs, written by the hook in the language of the reader. */
export interface AgentGraphWords {
    /** An amount in dong as an owner says it: "5 million". */
    readonly amount: (vnd: number) => string
}
