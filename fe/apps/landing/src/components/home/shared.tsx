import {
    ArrowRightIcon,
    ArrowUturnRightIcon,
    BanknotesIcon,
    Bars3Icon,
    BookOpenIcon,
    BuildingStorefrontIcon,
    ChatBubbleLeftRightIcon,
    CheckCircleIcon,
    CheckIcon,
    ChevronDownIcon,
    ClipboardDocumentCheckIcon,
    ClockIcon,
    CodeBracketIcon,
    ComputerDesktopIcon,
    CpuChipIcon,
    DocumentTextIcon,
    EnvelopeIcon,
    EyeIcon,
    HandRaisedIcon,
    InboxIcon,
    LanguageIcon,
    LifebuoyIcon,
    LinkIcon,
    PlusIcon,
    QuestionMarkCircleIcon,
    ShieldCheckIcon,
    UserCircleIcon,
    WalletIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline"
import type { ComponentType, SVGProps } from "react"

/** Prefixes every word with `nv-`: the home stylesheet's classes never collide with HeroUI / Grammar class names. */
export const nv = (names: string): string =>
    names
        .split(" ")
        .filter((name) => name !== "")
        .map((name) => `nv-${name}`)
        .join(" ")

/** The Heroicons 24 outline set the approved mockup draws (the landing's own icon set). */
const GLYPHS = {
    arrow: ArrowRightIcon,
    arrowturn: ArrowUturnRightIcon,
    banknotes: BanknotesIcon,
    menu: Bars3Icon,
    book: BookOpenIcon,
    store: BuildingStorefrontIcon,
    chat: ChatBubbleLeftRightIcon,
    checkc: CheckCircleIcon,
    check: CheckIcon,
    chevron: ChevronDownIcon,
    clipboard: ClipboardDocumentCheckIcon,
    clock: ClockIcon,
    code: CodeBracketIcon,
    desktop: ComputerDesktopIcon,
    cpu: CpuChipIcon,
    doc: DocumentTextIcon,
    mail: EnvelopeIcon,
    eye: EyeIcon,
    hand: HandRaisedIcon,
    inbox: InboxIcon,
    language: LanguageIcon,
    lifebuoy: LifebuoyIcon,
    link: LinkIcon,
    plus: PlusIcon,
    question: QuestionMarkCircleIcon,
    shield: ShieldCheckIcon,
    user: UserCircleIcon,
    wallet: WalletIcon,
    x: XMarkIcon,
} satisfies Record<string, ComponentType<SVGProps<SVGSVGElement>>>

/** The name of one glyph of the home page. */
export type GlyphName = keyof typeof GLYPHS

/** One decorative outline icon; `extra` adds nv- classes (`s16`, `arrow`). */
export const Glyph = (props: { readonly name: GlyphName; readonly extra?: string }) => {
    const Svg = GLYPHS[props.name]
    return <Svg aria-hidden="true" className={nv(`i ${props.extra ?? ""}`)} />
}

/** The drawn check of the paid states (the stroke draws itself where the stylesheet animates it). */
export const Tick = (props: { readonly small?: boolean }) => (
    <span className={nv("tick")} style={props.small === true ? { width: 32, height: 32 } : undefined}>
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={props.small === true ? { strokeDashoffset: 0, width: 18, height: 18 } : undefined}
        >
            <path d="m4.5 12.75 6 6 9-13.5" />
        </svg>
    </span>
)

/** Where every link of the home chrome leads; `anchor` builds an in-page link that also works from another page. */
export interface HomeLinks {
    readonly tryHref: string
    readonly signInHref: string
    readonly contactHref: string
    readonly privacyHref: string
    readonly termsHref: string
    readonly homeHref: string
    /** "" on the home page, "/" elsewhere. */
    readonly anchorBase: string
}

/** An in-page section link from any page of the site. */
export const anchor = (links: HomeLinks, id: string): string => `${links.anchorBase}#${id}`

/** The section ids the menus, the footer and the cards link to. */
export const SECTION = {
    top: "top",
    pains: "work",
    values: "agents",
    how: "how",
    product: "product",
    auto: "automation",
    connect: "connections",
    philosophy: "philosophy",
    pricing: "pricing",
    faq: "faq",
} as const
