import { Avatar } from "@starci/grammar/common"

/** What the mark draws: the key of the agent kind, the glyph its template declares, and whether the agent is still being read. */
type AgentKindMarkProps = {
    readonly module: string
    /** The svg path the module template declares (`glyph`, served by the catalogue); empty or absent when none is known. */
    readonly glyph?: string | undefined
    readonly isLoading?: boolean | undefined
}

/** The module's own glyph on the 24 grid, in the text colour of the mark: no new colour, no art. */
const GlyphMark = (props: { readonly path: string }) => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
        <path d={props.path} />
    </svg>
)

/**
 * The mark of an agent kind: its 3D emblem, the image `/agents/<key>.webp` (a host file named by convention). A kind with no emblem file
 * draws the glyph its template declares, and, when it declares none, the generic mark of the Avatar. The NIVO mascot is for NIVO itself.
 */
export const AgentKindMark = (props: AgentKindMarkProps) => (
    <Avatar
        name={props.module}
        {...(props.module === "" ? {} : { src: `/agents/${props.module}.webp` })}
        {...(props.glyph === undefined || props.glyph === "" ? {} : { fallback: <GlyphMark path={props.glyph} /> })}
        shape="square"
        size="md"
        isDecorative
        isLoading={props.isLoading === true}
    />
)
