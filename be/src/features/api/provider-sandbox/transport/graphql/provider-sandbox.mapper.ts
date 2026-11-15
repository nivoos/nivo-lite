import type {
    OpenedSandbox,
    SandboxCall,
    SandboxCase,
    SandboxDeliveryMode,
    SandboxInput,
    SandboxLatestRequest,
    SandboxNextCase,
    SandboxOutcome,
    SandboxPayLinkView,
    SandboxSendResult,
} from "@modules/domain/provider-sandbox"
import type {
    ExpireSandboxWaitRequest,
    OpenSandboxAccountRequest,
    SandboxAccountRequest,
    SandboxAccountView,
    SandboxAgentRequest,
    SandboxCallsRequest,
    SandboxPayLinkRequest,
    SandboxProviderRequest,
    SandboxWaitingRunsRequest,
    SandboxWorkspaceRequest,
    SendSandboxCaseRequest,
    SetSandboxNextCaseRequest,
    SetSandboxNextOutcomeRequest,
} from "../../application/provider-sandbox.contracts"
import type {
    ExpireSandboxWaitInput,
    OpenSandboxAccountInput,
    SandboxAccountAgentInput,
    SendSandboxCaseInput,
    SetSandboxNextCaseInput,
    SetSandboxNextOutcomeInput,
} from "./dto/provider-sandbox.inputs"
import type {
    OpenedSandboxAccountType,
    SandboxAccountType,
    SandboxCallType,
    SandboxCaseType,
    SandboxInputValueType,
    SandboxLatestRequestType,
    SandboxNextCaseType,
    SandboxPayLinkType,
    SandboxSendResultType,
} from "./dto/provider-sandbox.types"

/** The JSON text of a value; `null` for one JSON cannot write. */
const jsonOf = (value: unknown): string => JSON.stringify(value) ?? "null"

/** Maps the workspace of a read that takes nothing else. */
export const toSandboxWorkspaceRequest = (workspaceId: string): SandboxWorkspaceRequest => ({ workspaceId })

/** Maps the arguments of sandboxCases. */
export const toSandboxProviderRequest = (workspaceId: string, provider: string): SandboxProviderRequest => ({ workspaceId, provider })

/** Maps the arguments of a door about one sandbox account. */
export const toSandboxAccountRequest = (workspaceId: string, connectionId: string): SandboxAccountRequest => ({ workspaceId, connectionId })

/** Maps the arguments of sandboxPayLink. */
export const toSandboxPayLinkRequest = (workspaceId: string, linkId: string): SandboxPayLinkRequest => ({ workspaceId, linkId })

/** Maps the arguments of sandboxCalls. */
export const toSandboxCallsRequest = (workspaceId: string, connectionId: string, operation: string | null | undefined): SandboxCallsRequest => ({
    workspaceId,
    connectionId,
    operation: operation ?? undefined,
})

/** Maps the arguments of sandboxWaitingRuns. */
export const toSandboxWaitingRunsRequest = (workspaceId: string, limit: number | null | undefined): SandboxWaitingRunsRequest => ({
    workspaceId,
    limit: limit ?? undefined,
})

/** Maps the input of openSandboxAccount. */
export const toOpenSandboxAccountRequest = (workspaceId: string, input: OpenSandboxAccountInput): OpenSandboxAccountRequest => ({
    workspaceId,
    provider: input.provider,
    name: input.name,
    attachTo: input.attachTo ?? [],
})

/** Maps the input of attachSandboxAccount and detachSandboxAccount. */
export const toSandboxAgentRequest = (workspaceId: string, input: SandboxAccountAgentInput): SandboxAgentRequest => ({
    workspaceId,
    connectionId: input.connectionId,
    agentId: input.agentId,
})

/** Maps the input of sendSandboxCase. */
export const toSendSandboxCaseRequest = (workspaceId: string, input: SendSandboxCaseInput): SendSandboxCaseRequest => ({
    workspaceId,
    connectionId: input.connectionId,
    caseId: input.caseId,
    inputs: (input.inputs ?? []).map((one) => ({ name: one.name, value: one.value })),
    // `dropWebhook` is the page's old flag: the same as `mode: withheld` (to go once fe sends `mode`).
    ...(input.mode !== undefined && input.mode !== null
        ? { mode: input.mode as SandboxDeliveryMode }
        : input.dropWebhook === true
          ? { mode: "withheld" as const }
          : {}),
    ...(input.lateBySeconds === undefined || input.lateBySeconds === null ? {} : { lateBySeconds: input.lateBySeconds }),
})

/** Maps the input of setSandboxNextOutcome. */
export const toSetSandboxNextOutcomeRequest = (workspaceId: string, input: SetSandboxNextOutcomeInput): SetSandboxNextOutcomeRequest => ({
    workspaceId,
    connectionId: input.connectionId,
    operation: input.operation,
    outcome: input.outcome as SandboxOutcome,
})

/** Maps the input of setSandboxNextCase. */
export const toSetSandboxNextCaseRequest = (workspaceId: string, input: SetSandboxNextCaseInput): SetSandboxNextCaseRequest => ({
    workspaceId,
    connectionId: input.connectionId,
    caseId: input.caseId,
    ...(input.scope === undefined || input.scope === null ? {} : { scope: input.scope }),
})

/** Maps the input of expireSandboxWait. */
export const toExpireSandboxWaitRequest = (workspaceId: string, input: ExpireSandboxWaitInput): ExpireSandboxWaitRequest => ({
    workspaceId,
    runId: input.runId,
})

/** One connection as a sandbox account (its id, provider, name, status, creation time and the agents it is attached to). */
export const toSandboxAccountType = ({ account, agents }: SandboxAccountView): SandboxAccountType => ({
    id: account.id,
    provider: account.provider,
    name: account.name,
    status: account.status,
    createdAt: account.createdAt,
    agents: agents.map((agent) => ({ id: agent.id, label: agent.label })),
})

/** One case of a catalogue: inbound when it carries an inbound transformation, else outbound; examples as text. */
export const toSandboxCaseType = (one: SandboxCase): SandboxCaseType => ({
    id: one.id,
    label: one.label,
    direction: one.inbound === undefined ? "outbound" : "inbound",
    operation: one.operation ?? null,
    isDefault: one.default === true,
    outcome: one.outcome ?? null,
    polled: one.inbound?.polled === true,
    delivery: one.inbound?.delivery?.mode ?? null,
    trigger: one.inbound?.trigger ?? null,
    inputs: (one.inbound?.inputs ?? []).map((field) => ({
        name: field.name,
        label: field.label,
        kind: field.kind,
        example: String(field.example),
    })),
})

/** Inputs as name and value pairs, each value as text (a number as its decimal text). */
export const toSandboxInputValues = (input: SandboxInput): Array<SandboxInputValueType> =>
    Object.entries(input).map(([name, value]) => ({ name, value: String(value) }))

/** The latest request of an account, or null when the agent made none. */
export const toSandboxLatestRequestType = (latest: SandboxLatestRequest | null): SandboxLatestRequestType | null =>
    latest === null ? null : { operation: latest.operation, at: latest.at, inputs: toSandboxInputValues(latest.input) }

/** One next case. */
export const toSandboxNextCaseType = (next: SandboxNextCase): SandboxNextCaseType => ({
    operation: next.operation,
    caseId: next.caseId,
    isDefault: next.isDefault,
})

/** One logged call: the request and the answered value as JSON text, the error when it threw. */
export const toSandboxCallType = (call: SandboxCall): SandboxCallType => ({
    id: call.id,
    operation: call.operation,
    key: call.key,
    at: call.at,
    outcome: call.result.outcome,
    error: call.result.outcome === "threw" ? call.result.error : null,
    requestJson: jsonOf(call.request),
    answerJson: call.result.outcome === "answered" ? jsonOf(call.result.value) : null,
})

/** The result of one send: the inputs as text and each delivery with its body as JSON text. */
export const toSandboxSendResultType = (result: SandboxSendResult): SandboxSendResultType => ({
    caseId: result.caseId,
    inputs: toSandboxInputValues(result.input),
    deliveries: result.deliveries.map((delivery) => ({
        path: delivery.path,
        status: delivery.status,
        bodyJson: delivery.body === undefined || delivery.body === null ? null : jsonOf(delivery.body),
    })),
    webhookDropped: result.webhookDropped,
    mode: result.mode,
    lateBySeconds: result.lateBySeconds,
})

/** The account just opened. */
export const toOpenedSandboxAccountType = (opened: OpenedSandbox): OpenedSandboxAccountType => ({
    id: opened.id,
    sandboxKey: opened.sandboxKey,
})

/** One pay link: the account, the amounts, the state word, the cases that apply and the inputs the link gives them as text. */
export const toSandboxPayLinkType = (link: SandboxPayLinkView): SandboxPayLinkType => ({
    linkId: link.linkId,
    account: { id: link.account.id, provider: link.account.provider, label: link.account.label },
    amountVnd: link.amountVnd,
    content: link.content,
    orderCode: link.orderCode,
    status: link.status,
    amountReceivedVnd: link.amountReceivedVnd,
    caseIds: [...link.caseIds],
    inputs: toSandboxInputValues(link.inputs),
})
