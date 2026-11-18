import { NodeWait, ObjectFieldChanged, take, type ObjectFieldChangedItem } from "@starci/nivoos-sdk"
import { IsApproved } from "./is-approved.step.ts"
import type { State } from "../produce.workflow.ts"

/** The review of the cut writes the item's status: `approved` ends this run, `producing` sends it back. */
export class WaitVerdict extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            ObjectFieldChanged,
            {
                when: (items: Array<ObjectFieldChangedItem>) =>
                    items.filter(
                        (change) =>
                            change.typeKey === "gtm.content" &&
                            change.field === "status" &&
                            (change.to === "approved" || change.to === "producing"),
                    ),
            },
            (s, changes: Array<ObjectFieldChangedItem>) => {
                const first = changes.at(0)
                if (first !== undefined) s.verdict = { to: String(first.to) }
            },
        ),
    ]
    override readonly next = IsApproved
}
