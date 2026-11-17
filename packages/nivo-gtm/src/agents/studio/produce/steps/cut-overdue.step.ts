import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../produce.workflow.ts"

/** The due date passed with no cut: the team was told once and a person decides. */
export class CutOverdue extends NodeEnd<typeof State> {
    override readonly reason = "cut_overdue"
}
