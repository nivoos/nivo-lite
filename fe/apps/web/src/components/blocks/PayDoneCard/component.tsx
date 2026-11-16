import { Stack, Text } from "@starci/grammar/common"
import { AuthPanel } from "../../frames/AuthPanel"

/** The words of the page a payer's browser lands on after the payment page. */
export interface PayDoneCardBaseProps {
    readonly props: {
        readonly title: string
        readonly text: string
        readonly note: string
    }
}

/** Draws the generic "back from the payment page" card: a heading, one line of what happens next, and a small line. It holds no data. */
export const PayDoneCardBase = (props: PayDoneCardBaseProps) => (
    <AuthPanel label={props.props.title} title={props.props.title}>
        <Stack gap="row">
            <Text>{props.props.text}</Text>
            <Text size="sm" tone="muted">
                {props.props.note}
            </Text>
        </Stack>
    </AuthPanel>
)
