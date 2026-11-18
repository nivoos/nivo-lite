import { NodeWait, take, ObjectFieldChanged, type ObjectFieldChangedItem } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { Check } from "./check.step.ts"

/** The start: a lead's stage moved to `engaged` or `qualified`. One run per lead at a time; a second move queues, and the run's first check ends it when it no longer applies. */
export class Open extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            ObjectFieldChanged,
            {
                when: (changes: Array<ObjectFieldChangedItem>) =>
                    changes.filter(
                        (change) =>
                            change.typeKey === "gtm.lead" &&
                            change.field === "stage" &&
                            (change.to === "engaged" || change.to === "qualified"),
                    ),
            },
            (s, changes: Array<ObjectFieldChangedItem>) => {
                const first = changes.at(0)
                if (first !== undefined) s.leadId = first.objectId
            },
        ),
    ]
    override readonly next = Check
}
