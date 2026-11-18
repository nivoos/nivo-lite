import { NodeWait, ObjectFieldChanged, take, type ObjectFieldChangedItem, type StateOf } from "@starci/nivoos-sdk"
import { RecordCut } from "./record-cut.step.ts"
import { Remind } from "./remind.step.ts"
import type { State } from "../produce.workflow.ts"

/** Waits for the cut (status `cut_ready`) until the reminder time; if none comes the team is reminded. */
export class WaitCut extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            ObjectFieldChanged,
            {
                when: (items: Array<ObjectFieldChangedItem>) =>
                    items.filter(
                        (change) =>
                            change.typeKey === "gtm.content" && change.field === "status" && change.to === "cut_ready",
                    ),
            },
            (s, changes: Array<ObjectFieldChangedItem>) => {
                const first = changes.at(0)
                if (first !== undefined)
                    s.cut = {
                        objectId: first.objectId,
                        link: typeof first.values.evidence === "string" ? first.values.evidence : "",
                    }
            },
        ),
    ]
    override readonly timeout = (s: StateOf<typeof State>) => new Date(Date.parse(s.assigned?.remindAt ?? ""))
    override readonly next = RecordCut
    override readonly onTimeout = Remind
}
