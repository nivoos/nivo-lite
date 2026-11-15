import { PayDoneCard } from "@/components/blocks/PayDoneCard"

/** The words of the page, resolved by the page from its state. */
export interface PayDonePageBaseProps {
    readonly props: {
        readonly title: string
        readonly text: string
        readonly note: string
    }
}

/** Draws the card; the auth layout supplies the centred frame around it. */
export const PayDonePageBase = (props: PayDonePageBaseProps) => (
    <PayDoneCard title={props.props.title} text={props.props.text} note={props.props.note} />
)
