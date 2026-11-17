import { NodeWait, ObjectFieldChanged, take, type ObjectFieldChangedItem } from "@starci/nivoos-sdk"
import { Open } from "./open.step.ts"
import type { State } from "../publish.workflow.ts"

export class Hear extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            ObjectFieldChanged,
            { when: (items: ObjectFieldChangedItem[]) => items.filter((change) => change.typeKey === "gtm.publication" && change.field === "status" && change.to === "scheduled") },
            (s, changes: ObjectFieldChangedItem[]) => { const [first] = changes; if (first !== undefined) s.hear = { objectId: first.objectId } },
        ),
    ]
    override readonly next = Open
}
