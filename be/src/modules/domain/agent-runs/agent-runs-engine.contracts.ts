import type { AgentRunStatus, StepJson } from "./agent-runs.contracts"

/** One run as its readers read it: the flows, the thread runs, the stop door, the call guard and the cancel door. */
export interface RunView {
    /** The run. */
    readonly id: string
    /** The workspace. */
    readonly workspaceId: string
    /** The agent. */
    readonly agentId: string
    /** The wake it answers. */
    readonly wakeId: string
    /** The trigger step of the graph. */
    readonly trigger: string
    /** The published version it runs on, or null. */
    readonly versionId: string | null
    /** Where it stands. */
    readonly status: AgentRunStatus
    /** The trigger, intact. */
    readonly context: StepJson
    /** Why it stopped, or null. */
    readonly errorCode: string | null
    /** Whether a person was told it stopped. */
    readonly spoken: boolean
}

/** The run, or null when there is none. */
export type OptionalRunView = RunView | null

/** The id of a run, or null when there is none. */
export type OptionalRunId = string | null

/** An owner's or manager's request about one run (end it, pause it, resume it), as the run door receives it. */
export interface OwnerRunRequest {
    /** The Auth account asking. */
    readonly principalId: string
    /** The workspace the request is made in; the run must be one of its runs. */
    readonly workspaceId: string
    /** The run. */
    readonly runId: string
}

/** An owner's or manager's request to END a run, with what they chose in the confirm dialog. */
export interface OwnerEndRequest extends OwnerRunRequest {
    /** True: the agent's model words ONE line to the run's customer and it goes through the normal send door; false: nobody is told. */
    readonly tellCustomer: boolean
}

/** What the store did with an end: the run ended now, had already ended, or does not exist. */
export interface RunEndResult {
    /** `ended`, `already_ended` or `not_found`. */
    readonly kind: "ended" | "already_ended" | "not_found"
    /** The run as it stands after the write, or null when there is none. */
    readonly run: RunView | null
}

/** What the store did with a pause or a resume. */
export interface RunPauseResult {
    /**
     * `paused` / `resumed`, or why not: `already_paused`, `not_paused` (a resume of a run no person paused), `already_ended`,
     * `not_found`.
     */
    readonly kind: "paused" | "resumed" | "already_paused" | "not_paused" | "already_ended" | "not_found"
    /** The run as it stands after the write, or null when there is none. */
    readonly run: RunView | null
}

/** What the run door answers to an end. */
export interface OwnerEndAnswer {
    /** `ended`, `already_ended` or `not_found`. */
    readonly kind: RunEndResult["kind"]
    /** `effects_kept` when the run ended now: whatever its steps already sent or did stays as it is; null otherwise. */
    readonly note: "effects_kept" | null
    /** How many child runs it called that were in flight ended with it. */
    readonly children: number
}

/** What the run door answers to a pause or a resume. */
export interface OwnerPauseAnswer {
    /** As `RunPauseResult.kind`. */
    readonly kind: RunPauseResult["kind"]
}

/** Who ended, paused or resumed a run, and the run as it stands after it: what the after-write hooks of the run door are told. */
export interface RunByPerson {
    /** The run after the write. */
    readonly run: RunView
    /** The member who acted. */
    readonly memberId: string
    /** The name people see. */
    readonly name: string
}

/**
 * What runs after the run door wrote an end, a pause or a resume, once its transaction committed: the thread engine registers it when
 * the app starts (it holds this door, never the other way round). Each hook is the ONE engine place that closes what the run holds
 * (its stops and their cards, the wakes held behind it, its children) and tells the team once.
 */
export interface RunDoorHooks {
    /** After an end: closes what the run held, ends its children in flight, tells the team once, and words the customer line if asked. */
    ended(done: RunByPerson, tellCustomer: boolean): Promise<{ readonly children: number }>
    /** After a pause: tells the team once. */
    paused(done: RunByPerson): Promise<void>
    /** After a resume: releases the wakes held while paused (in the order they came) and tells the team once. */
    resumed(done: RunByPerson): Promise<void>
}
