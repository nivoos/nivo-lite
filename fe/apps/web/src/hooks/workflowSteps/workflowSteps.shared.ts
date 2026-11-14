import { graphQLErrorCode } from "@/modules/failure"
import { toast } from "@/modules/toast"

/** The code of the refusal when somebody published a version of the workflow after this page read it. */
const WORKFLOW_CONFLICT_CODE = "AGENT_GRAPHS_WORKFLOW_CONFLICT"

/** The words of a refused write of a step's setting. */
interface StepWriteFailureWords {
    /** The title of the failure toast. */
    readonly failed: string
    /** What a newer version of the workflow means for the person: nothing changed, the page was reloaded. */
    readonly conflict: string
}

/**
 * Tells the person why a write of a step's setting (its mode, its accounts) was refused. A newer version of the workflow reloads it and
 * says so in plain words; any other refusal toasts the back end's own message.
 */
export const reportStepWriteFailure = async (
    error: unknown,
    words: StepWriteFailureWords,
    reload: () => Promise<unknown>,
): Promise<void> => {
    if (graphQLErrorCode(error) === WORKFLOW_CONFLICT_CODE) {
        toast.danger(words.failed, { description: words.conflict })
        await reload()
        return
    }
    toast.danger(words.failed, { description: error instanceof Error && error.message !== "" ? error.message : undefined })
}
