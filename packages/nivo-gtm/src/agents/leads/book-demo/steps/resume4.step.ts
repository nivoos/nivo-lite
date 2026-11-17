import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { Book } from "./book.step.ts"
import { Resume5 } from "./resume5.step.ts"

export class Resume4 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.book.refusal !== undefined && s.book.refusal !== ""
    override readonly yes = Book
    override readonly no = Resume5
}
