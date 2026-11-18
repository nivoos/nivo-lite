import { NodeWait, ObjectFieldChanged, take, type ObjectFieldChangedItem } from "@starci/nivoos-sdk"
import { PrepareFolder } from "./prepare-folder.step.ts"
import type { State } from "../produce.workflow.ts"

/** A video script became `script_ok`: one run per content item (the subject is the object). */
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
                            change.to === "script_ok" &&
                            change.values.kind === "video",
                    ),
            },
            (s, changes: Array<ObjectFieldChangedItem>) => {
                const first = changes.at(0)
                if (first !== undefined) s.change = { objectId: first.objectId }
            },
        ),
    ]
    override readonly next = PrepareFolder
}
