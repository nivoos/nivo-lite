import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { Wait } from "./wait.step.ts"
import { Draft } from "./draft.step.ts"

/** Branches on `check.action === "wait"`: when it holds the run goes to `Wait`, otherwise to `Draft`. */
export class IsWait extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.check.action === "wait"
    override readonly yes = Wait
    override readonly no = Draft
}
