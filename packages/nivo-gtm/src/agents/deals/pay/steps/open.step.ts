import { NodeWait, take, ObjectFieldChanged, type ObjectFieldChangedItem } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"
import { Read } from "./read.step.ts"

/** The start: a deal moved to accepted. */
export class Open extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            ObjectFieldChanged,
            {
                when: (items: Array<ObjectFieldChangedItem>) =>
                    items.filter((c) => c.typeKey === "gtm.deal" && c.field === "status" && c.to === "accepted"),
            },
            (s, changes: Array<ObjectFieldChangedItem>) => {
                const first = changes.at(0)
                if (first !== undefined) s.change = { objectId: first.objectId, version: first.version }
            },
        ),
    ]
    override readonly next = Read
}
