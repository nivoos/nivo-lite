/**
 * A step the engine will not run FOR A RUN is refused when the run REACHES it, never earlier: one engine stop for a person (no AI core
 * output, no automatic retry, no side-node pass-over), the same card road as every engine stop, the step named on its card. The run stays
 * in flight, so it keeps its subject. Retry runs the step again (refused again while the cause stands); Skip ends the run.
 */

/** The step's node is not installed: the RUN compile of a pinned version accepts it and marks it (`CompiledStep.refusal`). */
export const STEP_NOT_INSTALLED = "graph_node_missing"

/** The thread crashed again at a place it was already re-driven from: the last drive refuses the steps it waits to run. */
export const STEP_REDRIVE_EXHAUSTED = "thread_redrive_exhausted"

/** The refusal codes, each an engine stop. */
export const STEP_REFUSALS: ReadonlySet<string> = new Set([STEP_NOT_INSTALLED, STEP_REDRIVE_EXHAUSTED])
