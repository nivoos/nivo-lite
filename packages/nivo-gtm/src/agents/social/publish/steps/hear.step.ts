import { NodeWait, ObjectFieldChanged, take, type ObjectFieldChangedItem } from "@starci/nivoos-sdk"
import { Open } from "./open.step.ts"
import type { State } from "../publish.workflow.ts"

/** Opens a run when a `gtm.publication` changes its status to `scheduled`. */
export class Hear extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            ObjectFieldChanged,
            {
                when: (items: Array<ObjectFieldChangedItem>) =>
                    items.filter(
                        (change) =>
                            change.typeKey === "gtm.publication" &&
                            change.field === "status" &&
                            change.to === "scheduled",
                    ),
            },
            (s, changes: Array<ObjectFieldChangedItem>) => {
                const first = changes.at(0)
                if (first !== undefined) s.hear = { objectId: first.objectId }
            },
        ),
    ]
    override readonly next = Open
}
