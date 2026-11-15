import { useFormatter, useLocale, useTranslations } from "next-intl"
import type { CSSProperties, ReactNode } from "react"
import { LANDING_OFFER } from "@/hooks/landing"
import { HeroStage } from "./HeroStage"
import { ModeSwitch } from "./ModeSwitch"
import { Glyph, SECTION, Tick, nv, type GlyphName } from "./shared"
import { homeLinks } from "./useHomeLinks"

/** A reveal delay for the staggered cards. */
const delay = (seconds: number): CSSProperties => ({ ["--d" as string]: `${seconds}s` })

const hl = (chunks: ReactNode) => <span className={nv("hl")}>{chunks}</span>

/** A bulleted list with the red check icon. */
const Checks = (props: { readonly items: ReadonlyArray<string> }) => (
    <ul className={nv("checks")}>
        {props.items.map((item) => (
            <li key={item}>
                <Glyph name="checkc" />
                <span className={nv("tx")}>{item}</span>
            </li>
        ))}
    </ul>
)

/** The link-like arrow used by the foreground links. */
const Arrow = () => <Glyph name="arrow" extra="s16 arrow" />

/** 2.1 Hero: the copy on the left, the animated console window on the right. */
const Hero = () => {
    const t = useTranslations("home")
    const links = homeLinks(useLocale(), true)
    return (
        <section className={nv("hero")} id={SECTION.top} aria-labelledby="nv-hero-title">
            <div className={nv("hero-grid-bg")} />
            <div className={nv("blob b1")} />
            <div className={nv("blob b2")} />
            <div className={nv("blob b3")} />
            <div className={nv("col hero-inner")}>
                <div className={nv("hero-copy")}>
                    <span className={nv("badge glass")}>
                        <span className={nv("dot live")} />
                        {t("hero.badge")}
                    </span>
                    <h1 className={nv("display")} id="nv-hero-title">
                        {t.rich("hero.title", { hl, under: (chunks) => <span className={nv("hl-under")}>{chunks}</span> })}
                    </h1>
                    <p className={nv("lead")} style={{ maxWidth: "36rem" }}>
                        {t("hero.lead")}
                    </p>
                    <div className={nv("cluster")}>
                        <a className={nv("btn primary lg")} data-nv-cta href={links.tryHref}>
                            {t("try")} <Glyph name="arrow" extra="arrow" />
                        </a>
                        <a className={nv("btn outline lg")} href={links.contactHref}>
                            {t("contact")}
                        </a>
                    </div>
                    <div className={nv("facts")}>
                        {[
                            t("hero.fact1"),
                            t("hero.fact2"),
                            t("hero.fact3"),
                            t("hero.fact4", {
                                days: LANDING_OFFER.trialDays,
                                card: LANDING_OFFER.cardRequired ? t("hero.withCard") : t("hero.noCard"),
                            }),
                        ].map((fact) => (
                            <span key={fact} className={nv("fact")}>
                                <Glyph name="checkc" />
                                {fact}
                            </span>
                        ))}
                    </div>
                    <p className={nv("tagline")}>
                        <b>Human Leads.</b> AI Operates. System Learns.
                    </p>
                </div>
                <HeroStage />
            </div>
        </section>
    )
}

/** The providers with a working connection in NIVO today (the only names the page claims). */
const PROVIDERS = ["Zalo OA", "Telegram", "SePay", "payOS"] as const

/** The channel strip under the hero: provider names as text, looping slowly. */
const Marquee = () => {
    const t = useTranslations("home.marquee")
    const row = (hidden: boolean, key: string) =>
        PROVIDERS.map((name) => (
            <span key={`${key}-${name}`} className={nv("pchip")} aria-hidden={hidden || undefined}>
                {name}
            </span>
        ))
    return (
        <div className={nv("marquee-band")} role="region" aria-label={t("aria")}>
            <div className={nv("col marquee-row")}>
                <span className={nv("marquee-label")}>{t("label")}</span>
                <div className={nv("marquee")}>
                    <div className={nv("marquee-track")}>
                        {row(false, "a")}
                        {row(true, "b")}
                        {row(true, "c")}
                        {row(true, "d")}
                        {row(true, "e")}
                        {row(true, "f")}
                        {row(true, "g")}
                        {row(true, "h")}
                    </div>
                </div>
            </div>
        </div>
    )
}

/** 2.2 The work that should not depend on memory, and who the page is for. */
const Pains = () => {
    const t = useTranslations("home.pains")
    const pains: ReadonlyArray<readonly [GlyphName, string]> = [
        ["clock", "p1"],
        ["chat", "p2"],
        ["wallet", "p3"],
        ["banknotes", "p4"],
        ["user", "p5"],
        ["inbox", "p6"],
    ]
    return (
        <section className={nv("band")} id={SECTION.pains} aria-labelledby="nv-s-pains">
            <div className={nv("col pain-grid")}>
                <div className={nv("stack g24 rv")}>
                    <span className={nv("eyebrow")}>{t("eyebrow")}</span>
                    <h2 className={nv("h2")} id="nv-s-pains">
                        {t("title")}
                    </h2>
                    <div className={nv("who")}>
                        <span className={nv("sublabel")}>{t("forLabel")}</span>
                        <span className={nv("big")}>{t("audience")}</span>
                    </div>
                </div>
                <div className={nv("pains")}>
                    {pains.map(([icon, key], index) => (
                        <div key={key} className={nv("pain lift rv")} style={delay(0.05 * (index + 1))}>
                            <span className={nv("tile")}>
                                <Glyph name={icon} />
                            </span>
                            <span>{t(key)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

/** 2.3 The four value groups of the agent team. */
const Values = () => {
    const t = useTranslations("home.values")
    const cards: ReadonlyArray<{ id: string; icon: GlyphName; items: number; href: string }> = [
        { id: "v1", icon: "banknotes", items: 6, href: `#${SECTION.how}` },
        { id: "v2", icon: "lifebuoy", items: 3, href: `#${SECTION.product}` },
        { id: "v3", icon: "clipboard", items: 2, href: `#${SECTION.product}` },
        { id: "v4", icon: "eye", items: 4, href: `#${SECTION.auto}` },
    ]
    return (
        <section className={nv("band white")} id={SECTION.values} aria-labelledby="nv-s-values">
            <div className={nv("col")}>
                <div className={nv("sec-head rv")}>
                    <div className={nv("l")}>
                        <span className={nv("eyebrow")}>{t("eyebrow")}</span>
                        <h2 className={nv("h2")} id="nv-s-values">
                            {t.rich("title", { hl })}
                        </h2>
                        <p className={nv("lead")}>{t("lead")}</p>
                    </div>
                </div>
                <div className={nv("values")}>
                    {cards.map((card, index) => (
                        <article key={card.id} className={nv("card vcard lift sheen rv")} style={delay(index % 2 === 1 ? 0.1 : 0)}>
                            <span className={nv("num")} aria-hidden="true">
                                {String(index + 1).padStart(2, "0")}
                            </span>
                            <div className={nv("vcard-head")}>
                                <span className={nv("tile")}>
                                    <Glyph name={card.icon} />
                                </span>
                                <div className={nv("stack")}>
                                    <h3 className={nv("h3")}>{t(`${card.id}Title`)}</h3>
                                    <span className={nv("en")} lang="en">
                                        {t(`${card.id}En`)}
                                    </span>
                                </div>
                            </div>
                            <Checks items={Array.from({ length: card.items }, (_, k) => t(`${card.id}i${k + 1}`))} />
                            <div className={nv("foot")}>
                                <a className={nv("link-fg")} href={card.href}>
                                    {t(`${card.id}Link`)} <Arrow />
                                </a>
                            </div>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    )
}

/** 2.4 One real flow: a sticky title column and five steps on a rail that fills with the scroll. */
const Flow = () => {
    const t = useTranslations("home.flow")
    return (
        <section className={nv("band")} id={SECTION.how} aria-labelledby="nv-s-flow">
            <div className={nv("col flow-grid")}>
                <div className={nv("flow-side rv")}>
                    <span className={nv("eyebrow")}>{t("eyebrow")}</span>
                    <h2 className={nv("h2")} id="nv-s-flow">
                        {t.rich("title", { hl })}
                    </h2>
                    <p className={nv("lead")}>{t("lead")}</p>
                    <div className={nv("branch")}>
                        <Glyph name="arrowturn" />
                        <span>{t("branch1")}</span>
                    </div>
                    <div className={nv("branch")}>
                        <Glyph name="arrowturn" />
                        <span>{t("branch2")}</span>
                    </div>
                    <a className={nv("link-fg")} href={`#${SECTION.product}`}>
                        {t("link")} <Arrow />
                    </a>
                </div>
                <ol className={nv("steps")}>
                    <li className={nv("rail")} aria-hidden="true">
                        <div className={nv("rail-fill")} />
                        <div className={nv("rail-dot")} />
                    </li>
                    {[1, 2, 3, 4, 5].map((n) => (
                        <li key={n} className={nv(n === 3 ? "step ask" : "step")}>
                            <span className={nv("node")} aria-hidden="true">
                                {n}
                            </span>
                            <div className={nv("who-row")}>
                                <span className={nv("agent")}>{t(`s${n}Agent`)}</span>
                                {n === 3 ? (
                                    <span className={nv("badge accent")}>
                                        <Glyph name="hand" extra="s16" />
                                        {t("askBadge")}
                                    </span>
                                ) : null}
                            </div>
                            <h3 className={nv("h3")}>{t(`s${n}Title`)}</h3>
                            <p>{t(`s${n}Text`)}</p>
                            {n === 3 ? <p className={nv("note")}>{t("s3Note")}</p> : null}
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    )
}

/** A row of a drawn console list. */
const MiniRow = (props: { readonly title: string; readonly meta: string; readonly badge: ReactNode; readonly agent?: boolean }) => (
    <div className={nv("mini-row")}>
        {props.agent === true ? (
            <span className={nv("av sm agent")}>
                <Glyph name="cpu" />
            </span>
        ) : null}
        <div className={nv("grow")}>
            <div className={nv("medium")}>{props.title}</div>
            <div className={nv("xs muted")}>{props.meta}</div>
        </div>
        {props.badge}
    </div>
)

/** 2.5 The five platform blocks as a bento, each with a piece of the console drawn from the real app. */
const Product = () => {
    const t = useTranslations("home.product")
    const running = (
        <span className={nv("badge success")}>
            <span className={nv("dot live")} />
            {t("running")}
        </span>
    )
    return (
        <section className={nv("band white")} id={SECTION.product} aria-labelledby="nv-s-product">
            <div className={nv("col")}>
                <div className={nv("sec-head rv")}>
                    <div className={nv("l")}>
                        <span className={nv("eyebrow")}>{t("eyebrow")}</span>
                        <h2 className={nv("h2")} id="nv-s-product">
                            {t.rich("title", { hl })}
                        </h2>
                    </div>
                    <span className={nv("xs muted")}>{t("note")}</span>
                </div>
                <div className={nv("bento")}>
                    <article className={nv("card b-chat lift rv")}>
                        <div className={nv("vcard-head")}>
                            <span className={nv("tile")}>
                                <Glyph name="chat" />
                            </span>
                            <h3 className={nv("h3")}>{t("chatTitle")}</h3>
                        </div>
                        <Checks items={[t("chat1"), t("chat2"), t("chat3")]} />
                        <div className={nv("mini")} aria-hidden="true">
                            <div className={nv("chatframe")}>
                                <div className={nv("msg")}>
                                    <span className={nv("av sm agent")}>
                                        <Glyph name="cpu" />
                                    </span>
                                    <div className={nv("msg-body")}>
                                        <span className={nv("xs muted")}>{t("cm1Meta")}</span>
                                        <div className={nv("msg-card")}>
                                            <div className={nv("msg-title")}>
                                                <span className={nv("t")}>{t("cm1Title")}</span>
                                                <span className={nv("badge")}>{t("cm1Badge")}</span>
                                            </div>
                                            <p className={nv("sm")}>{t("cm1Text")}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className={nv("msg")}>
                                    <span className={nv("av sm agent")}>
                                        <Glyph name="banknotes" />
                                    </span>
                                    <div className={nv("msg-body")}>
                                        <span className={nv("xs muted")}>{t("cm2Meta")}</span>
                                        <div className={nv("msg-card")}>
                                            <div className={nv("msg-title")}>
                                                <span className={nv("t")}>{t("cm2Title")}</span>
                                                <span className={nv("badge accent")}>{t("cm2Badge")}</span>
                                            </div>
                                            <p className={nv("sm")}>{t("cm2Text")}</p>
                                            <div className={nv("kv lines sm")}>
                                                <div>
                                                    <span className={nv("muted")}>{t("cm2AmountLabel")}</span>
                                                    <span>{t("cm2Amount")}</span>
                                                </div>
                                                <div>
                                                    <span className={nv("muted")}>{t("cm2MemoLabel")}</span>
                                                    <span>{t("cm2Memo")}</span>
                                                </div>
                                            </div>
                                            <hr className={nv("divider")} />
                                            <div className={nv("cluster")} style={{ gap: 8 }}>
                                                <span className={nv("btn outline sm")}>{t("retry")}</span>
                                                <span className={nv("btn outline sm")}>{t("takeOver")}</span>
                                                <span className={nv("btn outline sm")}>{t("skip")}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </article>
                    <article className={nv("card b-agents lift rv")} style={delay(0.08)}>
                        <div className={nv("vcard-head")}>
                            <span className={nv("tile")}>
                                <Glyph name="cpu" />
                            </span>
                            <h3 className={nv("h3")}>{t("agentsTitle")}</h3>
                        </div>
                        <Checks items={[t("agents1"), t("agents2"), t("agents3")]} />
                        <div className={nv("mini")} aria-hidden="true">
                            <MiniRow agent title={t("agentA")} meta={t("agentAAccounts")} badge={running} />
                            <MiniRow agent title={t("agentB")} meta={t("agentBAccounts")} badge={running} />
                        </div>
                    </article>
                    <article className={nv("card b-brain lift rv")} style={delay(0.16)}>
                        <div className={nv("vcard-head")}>
                            <span className={nv("tile")}>
                                <Glyph name="book" />
                            </span>
                            <h3 className={nv("h3")}>{t("brainTitle")}</h3>
                        </div>
                        <Checks items={[t("brain1"), t("brain2"), t("brain3")]} />
                        <div className={nv("mini")} aria-hidden="true">
                            <MiniRow title={t("fact1")} meta={t("fact1Src")} badge={<span className={nv("badge")}>{t("fact1Badge")}</span>} />
                            <MiniRow title={t("fact2")} meta={t("fact2Src")} badge={<span className={nv("badge accent")}>{t("fact2Badge")}</span>} />
                        </div>
                    </article>
                    <article className={nv("card b-work lift rv")}>
                        <div className={nv("vcard-head")}>
                            <span className={nv("tile")}>
                                <Glyph name="desktop" />
                            </span>
                            <h3 className={nv("h3")}>{t("workTitle")}</h3>
                        </div>
                        <Checks items={[t("work1"), t("work2"), t("work3")]} />
                        <div className={nv("mini")} aria-hidden="true">
                            <div className={nv("mini-row")}>
                                <div className={nv("grow stack g8")}>
                                    <div className={nv("cluster")} style={{ justifyContent: "space-between", gap: 8 }}>
                                        <span className={nv("medium")}>{t("workNow")}</span>
                                        <span className={nv("xs muted")}>{t("workStep")}</span>
                                    </div>
                                    <div className={nv("bar-mini")}>
                                        <span />
                                    </div>
                                </div>
                            </div>
                            <MiniRow title={t("workDone")} meta={t("workDoneMeta")} badge={<span className={nv("badge")}>{t("workDoneBadge")}</span>} />
                        </div>
                    </article>
                    <article className={nv("card b-conn lift rv")} style={delay(0.08)}>
                        <div className={nv("vcard-head")}>
                            <span className={nv("tile")}>
                                <Glyph name="link" />
                            </span>
                            <h3 className={nv("h3")}>{t("connTitle")}</h3>
                        </div>
                        <Checks items={[t("conn1"), t("conn2"), t("conn3")]} />
                        <div className={nv("mini")} aria-hidden="true">
                            <MiniRow title={t("connRow")} meta={t("connRowMeta")} badge={running} />
                        </div>
                    </article>
                </div>
            </div>
        </section>
    )
}

/** 2.6 You choose the automation level: live mode switches and an answered approval card. */
const Automation = () => {
    const t = useTranslations("home.auto")
    const rows: ReadonlyArray<readonly [string, "auto" | "ask"]> = [
        ["row1", "auto"],
        ["row2", "ask"],
        ["row3", "auto"],
    ]
    return (
        <section className={nv("band tint")} id={SECTION.auto} aria-labelledby="nv-s-auto">
            <div className={nv("col auto-grid")}>
                <div className={nv("stack g24 rv")}>
                    <span className={nv("eyebrow")}>{t("eyebrow")}</span>
                    <h2 className={nv("h2")} id="nv-s-auto">
                        {t.rich("title", { hl })}
                    </h2>
                    <p className={nv("lead")}>{t("lead")}</p>
                    <Checks items={[t("c1"), t("c2")]} />
                </div>
                <div className={nv("stack g16 rv")} style={delay(0.15)}>
                    <span className={nv("sublabel")}>{t("sublabel")}</span>
                    <div className={nv("modes")}>
                        {rows.map(([key, initial], index) => (
                            <div key={key} className={nv("mode-row")}>
                                <span>{t(key)}</span>
                                <ModeSwitch
                                    label={t(key)}
                                    initial={initial}
                                    autoLabel={t("modeAuto")}
                                    askLabel={t("modeAsk")}
                                    demo={index === 2}
                                />
                            </div>
                        ))}
                    </div>
                    <div className={nv("msg-card answered")}>
                        <div className={nv("msg-title")}>
                            <span className={nv("t")}>{t("cardTitle")}</span>
                            <span className={nv("badge")}>{t("cardBadge")}</span>
                        </div>
                        <span className={nv("sublabel")}>{t("cardAnswers")}</span>
                        <div className={nv("kv lines")}>
                            <div>
                                <span>{t("answer1")}</span>
                                <span className={nv("xs muted")}>{t("answerTime")}</span>
                            </div>
                            <div>
                                <span>{t("answer2")}</span>
                                <span className={nv("xs muted")}>{t("answerTime")}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

/** 2.7 Connections: only the providers that work in NIVO today, and the MCP strip. */
const Connections = () => {
    const t = useTranslations("home.connect")
    const home = useTranslations("home")
    const links = homeLinks(useLocale(), true)
    const group = (title: string, rows: ReadonlyArray<readonly [string, string]>, wait: number) => (
        <div className={nv("list-card lift rv")} style={delay(wait)}>
            <div className={nv("head")}>{title}</div>
            {rows.map(([name, text]) => (
                <div key={name} className={nv("row conn-row")}>
                    <span className={nv("stack")}>
                        <span className={nv("strong")}>{name}</span>
                        <span className={nv("sm muted")}>{text}</span>
                    </span>
                </div>
            ))}
        </div>
    )
    return (
        <section className={nv("band white tight")} id={SECTION.connect} aria-labelledby="nv-s-conn">
            <div className={nv("col")}>
                <div className={nv("sec-head rv")}>
                    <div className={nv("l")}>
                        <span className={nv("eyebrow")}>{t("eyebrow")}</span>
                        <h2 className={nv("h2")} id="nv-s-conn">
                            {t("title")}
                        </h2>
                    </div>
                    <a className={nv("link-fg")} href={links.contactHref}>
                        {t("more")} {home("contact")} <Arrow />
                    </a>
                </div>
                <div className={nv("conn-grid two")}>
                    {group(
                        t("channels"),
                        [
                            ["Zalo OA", t("zaloText")],
                            ["Telegram", t("telegramText")],
                        ],
                        0,
                    )}
                    {group(
                        t("payments"),
                        [
                            ["SePay", t("sepayText")],
                            ["payOS", t("payosText")],
                        ],
                        0.08,
                    )}
                    <div className={nv("dev-card rv")}>
                        <span className={nv("cluster")} style={{ gap: 14 }}>
                            <code>MCP</code>
                            <span>{t("devText")}</span>
                        </span>
                    </div>
                </div>
            </div>
        </section>
    )
}

/** 2.8 The philosophy band on ink. */
const Philosophy = () => {
    const t = useTranslations("home.philosophy")
    return (
        <section className={nv("band ink")} id={SECTION.philosophy} aria-labelledby="nv-s-phil">
            <div className={nv("ink-glow g1")} />
            <div className={nv("ink-glow g2")} />
            <div className={nv("col")}>
                <span className={nv("eyebrow rv")}>{t("eyebrow")}</span>
                <h2 className={nv("manifesto rv")} id="nv-s-phil" style={{ marginTop: 20 }} lang="en">
                    <span>{t("m1")}</span>
                    <span className={nv("m2")}>{t("m2")}</span>
                    <span className={nv("m3")}>{t("m3")}</span>
                </h2>
                <div className={nv("pillars")}>
                    {[1, 2, 3].map((n) => (
                        <div key={n} className={nv("pillar rv")} style={delay(0.1 * (n - 1))}>
                            <span className={nv("n")}>{`0${n}`}</span>
                            <span className={nv("t")}>{t(`p${n}Title`)}</span>
                            <p>{t(`p${n}Text`)}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

/** 2.10 Pricing: exactly the plan data the landing publishes (LANDING_OFFER), no other figure. */
const Pricing = () => {
    const t = useTranslations("home.pricing")
    const format = useFormatter()
    const links = homeLinks(useLocale(), true)
    const price = format.number(LANDING_OFFER.startPriceVnd, { style: "currency", currency: "VND", maximumFractionDigits: 0 })
    return (
        <section className={nv("band white")} id={SECTION.pricing} aria-labelledby="nv-s-price">
            <div className={nv("col")}>
                <div className={nv("sec-head rv")}>
                    <div className={nv("l")}>
                        <span className={nv("eyebrow")}>{t("eyebrow")}</span>
                        <h2 className={nv("h2")} id="nv-s-price">
                            {t("title")}
                        </h2>
                        <p className={nv("lead")}>{t("lead")}</p>
                    </div>
                </div>
                <div className={nv("price-grid")}>
                    <article className={nv("card price-card lift sheen rv")}>
                        <span className={nv("plan")}>{t("planName")}</span>
                        <div className={nv("figure")}>
                            {price} <small>{t("perMonth")}</small>
                        </div>
                        <span className={nv("muted sm")}>{t("afterTrial")}</span>
                        <hr className={nv("divider")} />
                        <p>{t("startText")}</p>
                    </article>
                    <article className={nv("card price-card lift sheen rv")} style={delay(0.08)}>
                        <span className={nv("plan")}>{t("trialTitle")}</span>
                        <div className={nv("figure")}>{t("trialFigure", { days: LANDING_OFFER.trialDays })}</div>
                        <hr className={nv("divider")} />
                        <p>{t("trialText", { card: LANDING_OFFER.cardRequired ? t("trialCard") : t("trialNoCard") })}</p>
                    </article>
                    <article className={nv("card price-card lift sheen rv")} style={delay(0.16)}>
                        <span className={nv("plan")}>{t("teamTitle")}</span>
                        <div className={nv("figure")}>{t("teamFigure")}</div>
                        <hr className={nv("divider")} />
                        <p>{t("teamText")}</p>
                        <a className={nv("link-fg")} href={links.contactHref}>
                            {t("teamLink")} <Arrow />
                        </a>
                    </article>
                </div>
            </div>
        </section>
    )
}

/** 2.11 FAQ: a sticky title column and eight answers. */
const Faq = () => {
    const t = useTranslations("home.faq")
    const offer = useTranslations("home.pricing")
    const format = useFormatter()
    const links = homeLinks(useLocale(), true)
    const contact = (chunks: ReactNode) => (
        <a className={nv("link-prose")} href={links.contactHref}>
            {chunks}
        </a>
    )
    const privacy = (chunks: ReactNode) => (
        <a className={nv("link-prose")} href={links.privacyHref}>
            {chunks}
        </a>
    )
    const price = format.number(LANDING_OFFER.startPriceVnd, { style: "currency", currency: "VND", maximumFractionDigits: 0 })
    const card = LANDING_OFFER.cardRequired ? offer("trialCard") : offer("trialNoCard")
    const answers: ReadonlyArray<ReactNode> = [
        t("a1"),
        t("a2"),
        t("a3"),
        t.rich("a4", { link: contact }),
        t("a5", { plan: offer("planName"), price }),
        t("a6", { days: LANDING_OFFER.trialDays, card }),
        t.rich("a7", { link: privacy }),
        t("a8"),
    ]
    return (
        <section className={nv("band")} id={SECTION.faq} aria-labelledby="nv-s-faq">
            <div className={nv("col faq-grid")}>
                <div className={nv("stack g16 rv faq-side")}>
                    <span className={nv("eyebrow")}>{t("eyebrow")}</span>
                    <h2 className={nv("h2")} id="nv-s-faq">
                        {t("title")}
                    </h2>
                    <p className={nv("lead")}>{t.rich("lead", { link: contact })}</p>
                </div>
                <div className={nv("faq-list")}>
                    {answers.map((answer, index) => (
                        <details key={index} className={nv("rv")} open={index === 0}>
                            <summary>
                                {t(`q${index + 1}`)}
                                <span className={nv("pm")}>
                                    <Glyph name="plus" extra="s16" />
                                </span>
                            </summary>
                            <p className={nv("ans")}>{answer}</p>
                        </details>
                    ))}
                </div>
            </div>
        </section>
    )
}

/** 2.12 The closing ink block with the second primary CTA. */
const Closing = () => {
    const t = useTranslations("home")
    const links = homeLinks(useLocale(), true)
    return (
        <section className={nv("band tight closing-band")} aria-labelledby="nv-s-cta">
            <div className={nv("col")}>
                <div className={nv("closing rv")}>
                    <div className={nv("grid-ink")} />
                    <div className={nv("ink-glow g1")} />
                    <div className={nv("ink-glow g2")} />
                    <div className={nv("close-chain")} aria-hidden="true">
                        <div className={nv("cc")}>
                            <span className={nv("av agent")}>
                                <Glyph name="chat" />
                            </span>
                            <span className={nv("stack")}>
                                <span className={nv("strong")}>{t("closing.c1Title")}</span>
                                <span className={nv("xs")}>{t("closing.c1Text")}</span>
                            </span>
                        </div>
                        <div className={nv("cc")}>
                            <span className={nv("av agent")}>
                                <Glyph name="hand" />
                            </span>
                            <span className={nv("stack")}>
                                <span className={nv("strong")}>{t("closing.c2Title")}</span>
                                <span className={nv("xs")}>{t("closing.c2Text")}</span>
                            </span>
                        </div>
                        <div className={nv("cc")}>
                            <Tick small />
                            <span className={nv("stack")}>
                                <span className={nv("strong")}>{t("closing.c3Title")}</span>
                                <span className={nv("xs")}>{t("closing.c3Text")}</span>
                            </span>
                        </div>
                    </div>
                    <div className={nv("stack g24")} style={{ maxWidth: "44rem" }}>
                        <h2 className={nv("display closing-title")} id="nv-s-cta">
                            {t.rich("closing.title", { coral: (chunks) => <span className={nv("coral")}>{chunks}</span> })}
                        </h2>
                        <p className={nv("lead")}>{t("closing.lead")}</p>
                        <div className={nv("cluster")}>
                            <a className={nv("btn primary lg")} data-nv-cta href={links.tryHref}>
                                {t("try")} <Glyph name="arrow" extra="arrow" />
                            </a>
                            <a className={nv("btn on-ink lg")} href={links.contactHref}>
                                {t("contact")}
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

/** The home page of nivo.vn, in the order of the approved design (the NIVO Web story section waits for the owner). */
export const HomeSections = () => (
    <>
        <Hero />
        <Marquee />
        <Pains />
        <Values />
        <Flow />
        <Product />
        <Automation />
        <Connections />
        <Philosophy />
        <Pricing />
        <Faq />
        <Closing />
    </>
)
