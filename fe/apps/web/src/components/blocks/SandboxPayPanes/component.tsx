import { SlotView } from "@nivo-lite/agent-sdk/client"
import { Alert, Button, EmptyNotice, Page, Stack, SurfaceCard, Text } from "@starci/grammar/common"
import { nivoIconSource } from "@/components/leaves/Icon"
import type { SandboxPayData, SandboxPayPanesBaseProps } from "@/modules/types"

type Props = SandboxPayPanesBaseProps

/** The card while the first read loads: the rows keep the geometry of the real ones. */
const PLACEHOLDER: SandboxPayData = {
    refusal: null,
    accountId: "placeholder",
    facts: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id: `fact:${id}`, term: " ", value: " " })),
    caseId: null,
    inputs: [],
}

/** The page props with the data the card draws and whether it is still the placeholder. */
interface CardProps extends Props {
    readonly data: SandboxPayData
    readonly isLoading: boolean
}

/** What one neutral notice says. */
interface NoticeProps {
    readonly title: string
    readonly body: string
}

/** One neutral notice: a title over one 12 muted sentence, no control. */
const Notice = (props: NoticeProps) => (
    <SurfaceCard ariaLabel={props.title}>
        <Stack gap="identity">
            <Text isStrong>{props.title}</Text>
            <Text size="xs" tone="muted">
                {props.body}
            </Text>
        </Stack>
    </SurfaceCard>
)

/** The facts of the link as one list card: each row a value (14) over its muted term (12). */
const FactsCard = (props: CardProps) => (
    <SurfaceCard
        kind="list"
        label={props.props.copy.request.title}
        headingLevel={2}
        isLoading={props.isLoading}
        items={props.data.facts.map((fact) => ({
            id: fact.id,
            title: fact.value,
            description: (
                <Text as="span" size="xs" tone="muted">
                    {fact.term}
                </Text>
            ),
        }))}
        empty={null}
    />
)

/** What a read page draws: a neutral notice for a link the sandbox refuses (unknown, a live account, the switch off), else the facts of the link. */
const PayCards = (props: CardProps) => {
    const { copy } = props.props
    if (props.data.refusal === "off") return <Notice title={copy.offTitle} body={copy.offBody} />
    if (props.data.refusal !== null) return <Notice {...copy.refusals[props.data.refusal]} />
    return <FactsCard {...props} />
}

/** The neutral notice of an environment without a sandbox: the same as the Sandbox page. No control. */
const OffNotice = (props: Props) => <Notice title={props.props.copy.offTitle} body={props.props.copy.offBody} />

/** The body of the page for the gate it is in: the same notices as the Sandbox page, then the read cards. */
const BodyOf = (props: Props) => {
    switch (props.props.gate) {
        case "off":
            return <OffNotice {...props} />
        case "staff":
            return (
                <EmptyNotice
                    message={props.props.copy.staffTitle}
                    iconSource={nivoIconSource("profile", "leading")}
                    description={props.props.copy.staffBody}
                />
            )
        case "failed":
            return (
                <Alert
                    tone="negative"
                    title={props.props.copy.failTitle}
                    description={props.props.copy.failBody}
                    action={{ label: props.props.copy.retryLabel, onAction: props.on.retryGate }}
                />
            )
        case "checking":
        case "on":
            return (
                <SlotView
                    slot={props.props.data}
                    placeholder={PLACEHOLDER}
                    labels={props.props.slotLabels}
                    errorDescription={props.props.copy.request.errorTitle}
                    errorLayout="band"
                    onRetry={props.on.retryData}
                    render={(data, isLoading) => <PayCards {...props} data={data} isLoading={isLoading} />}
                />
            )
    }
}

/** The case the page's one primary command sends; null while nothing is read, for a refused link and once the link is paid, cancelled or expired. */
const primaryOf = (props: Props): string | null => ("items" in props.props.data ? props.props.data.items.caseId : null)

/** The header: the title, the one sentence that no money moves and, where the sandbox exists, the page's one primary command. */
const headerOf = (props: Props) => {
    const primary = primaryOf(props)
    const hasSandbox = props.props.gate === "on" || props.props.gate === "checking"
    return {
        breadcrumbs: "root" as const,
        title: props.props.copy.title,
        ...(hasSandbox
            ? {
                  description: props.props.copy.description,
                  actions: (
                      <Button
                          intent="commit"
                          startGlyph="success"
                          isDisabled={primary === null || props.props.gate !== "on"}
                          isPending={primary !== null && props.props.sendingId === primary}
                          onPress={props.on.send}
                      >
                          {props.props.copy.paidLabel}
                      </Button>
                  ),
              }
            : {}),
    }
}

/**
 * Draws the pretend payment page of a sandbox pay link (NIVO Sandbox, "fake payment"): one sentence that no money moves and the facts
 * of the link (account, amount, content, order code, state). The page's one primary command sends the case the link names through
 * the link's own account; it is disabled once the link is paid, cancelled or expired. A link the sandbox refuses is a neutral notice.
 */
export const SandboxPayPanesBase = (props: SandboxPayPanesBaseProps) => (
    <Page measure="product" header={headerOf(props)}>
        <BodyOf {...props} />
    </Page>
)
