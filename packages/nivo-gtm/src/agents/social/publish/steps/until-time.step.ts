import { NodeWait, ObjectFieldChanged, take, type ObjectFieldChangedItem, type StateOf } from "@starci/nivoos-sdk"
import { AfterChange } from "./after-change.step.ts"
import { FinalCheck } from "./final-check.step.ts"
import type { State } from "../publish.workflow.ts"

/** Waits until the slot time, and wakes early when the publication changes (for instance it is cancelled). */
export class UntilTime extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            ObjectFieldChanged,
            {
                when: (items: Array<ObjectFieldChangedItem>) =>
                    items.filter(
                        (change) =>
                            change.typeKey === "gtm.publication" &&
                            (change.field === "at" || (change.field === "status" && change.to === "cancelled")),
                    ),
            },
            (s, changes: Array<ObjectFieldChangedItem>) => {
                const first = changes.at(0)
                if (first !== undefined) s.change = { field: first.field, to: String(first.to) }
            },
        ),
    ]
    override readonly timeout = (s: StateOf<typeof State>) => new Date(Date.parse(s.slot?.at ?? ""))
    override readonly next = AfterChange
    override readonly onTimeout = FinalCheck
}
