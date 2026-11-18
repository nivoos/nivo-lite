import { NodeWait, ObjectFieldChanged, take, type ObjectFieldChangedItem } from "@starci/nivoos-sdk"
import { Read } from "./read.step.ts"
import type { State } from "../post-draft.workflow.ts"

/** Opens a run when a `gtm.content` post idea changes its status to `chosen`. */
export class Open extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            ObjectFieldChanged,
            {
                when: (items: Array<ObjectFieldChangedItem>) =>
                    items.filter(
                        (change) =>
                            change.typeKey === "gtm.content" &&
                            change.field === "status" &&
                            change.to === "chosen" &&
                            change.values.kind === "post",
                    ),
            },
            (s, changes: Array<ObjectFieldChangedItem>) => {
                const first = changes.at(0)
                if (first !== undefined) s.change = { objectId: first.objectId }
            },
        ),
    ]
    override readonly next = Read
}
