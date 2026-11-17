import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialPublishOpen as OpenCell } from "../open.cell.ts"
import { UntilTime } from "./until-time.step.ts"
import type { State } from "../publish.workflow.ts"

export class Open extends NodeRun(OpenCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.hear.objectId })
    override readonly into = ["slot"] as const
    override readonly next = UntilTime
}
