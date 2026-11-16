import { Stack, Sublabel, SurfaceCard, Text } from "@starci/grammar/common"
import type { StepFactSectionView } from "@/modules/types"

/** What one section of the explanation draws. */
interface StepFactSectionProps {
    readonly section: StepFactSectionView
}

/**
 * One fact of the step, read only: its Sublabel above and a list card of labelled rows (the label 14, the value 14 at the end of the
 * row, the helper a muted 12 line under the label), rows divided by full-width hairlines. A workflow's graph is its template's, so
 * nothing here edits anything.
 */
export const StepFactSection = (props: StepFactSectionProps) => (
    <Stack gap="row">
        <Sublabel>{props.section.title}</Sublabel>
        <SurfaceCard
            kind="list"
            ariaLabel={props.section.title}
            empty={null}
            items={props.section.rows.map((row) => ({
                id: row.id,
                title: row.label,
                ...(row.helper === "" ? {} : { description: row.helper }),
                value: <Text>{row.value}</Text>,
            }))}
        />
    </Stack>
)
