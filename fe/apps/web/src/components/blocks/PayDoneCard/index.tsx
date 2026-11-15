import { PayDoneCardBase, type PayDoneCardBaseProps } from "./component"

/** The words of the generic "back from the payment page" card. */
type PayDoneCardProps = PayDoneCardBaseProps["props"]

/** The card of the page a payer's browser lands on after the payment page: pure words, no data, no action. */
export const PayDoneCard = (props: PayDoneCardProps) => <PayDoneCardBase props={props} />
