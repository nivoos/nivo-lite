"use client"

import { useTranslations } from "next-intl"
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useLanguage } from "@/hooks/locale"
import { Glyph, SECTION, anchor, nv, type GlyphName, type HomeLinks } from "./shared"

type MenuName = "platform" | "solutions" | "resources"
const MENUS: ReadonlyArray<MenuName> = ["platform", "solutions", "resources"]

/** One link of a mega menu: icon tile, title and a one-line description. */
const MegaLink = (props: { readonly href: string; readonly icon: GlyphName; readonly title: string; readonly text?: string; readonly onPick: () => void }) => (
    <a className={nv("mega-link")} href={props.href} onClick={props.onPick}>
        <span className={nv("tile")}>
            <Glyph name={props.icon} />
        </span>
        {props.text === undefined ? (
            <span className={nv("t")} style={{ alignSelf: "center" }}>
                {props.title}
            </span>
        ) : (
            <span className={nv("stack g4")}>
                <span className={nv("t")}>{props.title}</span>
                <span className={nv("xs muted")}>{props.text}</span>
            </span>
        )}
    </a>
)

/** The round language button with its dropdown (the fixed locale switch). */
const LocaleMenu = (props: { readonly extra?: string }) => {
    const t = useTranslations("home")
    const language = useLanguage()
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    const button = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        if (!open) return
        const away = (event: MouseEvent) => {
            if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false)
        }
        const escape = (event: globalThis.KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false)
                button.current?.focus()
            }
        }
        document.addEventListener("click", away)
        document.addEventListener("keydown", escape)
        return () => {
            document.removeEventListener("click", away)
            document.removeEventListener("keydown", escape)
        }
    }, [open])
    return (
        <div className={nv(`locale ${props.extra ?? ""}`)} data-open={open} ref={root}>
            <button
                ref={button}
                type="button"
                className={nv("btn tertiary icon-btn")}
                aria-label={t("language")}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                        event.preventDefault()
                        setOpen(true)
                        requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>("[role=menuitemradio]")?.focus())
                    }
                }}
            >
                <Glyph name="language" />
            </button>
            <div className={nv("locale-menu")} role="menu" aria-label={t("language")}>
                <div className={nv("sec")}>{t("language")}</div>
                {language.options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        className={nv("opt")}
                        role="menuitemradio"
                        aria-checked={option.value === language.locale}
                        tabIndex={open ? 0 : -1}
                        onClick={() => {
                            setOpen(false)
                            language.choose(option.value)
                        }}
                    >
                        <span>{option.name}</span>
                        {option.value === language.locale ? <Glyph name="check" extra="s16" /> : <span />}
                    </button>
                ))}
            </div>
        </div>
    )
}

/** The phone drawer: the same three menus as disclosure lists, the actions at the foot. */
const Drawer = (props: { readonly links: HomeLinks; readonly open: boolean; readonly close: () => void; readonly groups: ReactNode }) => {
    const t = useTranslations("home")
    const closeButton = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        if (props.open) closeButton.current?.focus()
    }, [props.open])
    return (
        <div className={nv("drawer")} data-open={props.open} aria-hidden={!props.open}>
            <div className={nv("drawer-backdrop")} onClick={props.close} />
            <div className={nv("drawer-panel")} role="dialog" aria-modal="true" aria-label={t("menuTitle")}>
                <div className={nv("drawer-head")}>
                    <img src="/brand/nivo-logo.png" alt="NIVO" width={90} height={32} style={{ objectFit: "contain" }} />
                    <button ref={closeButton} type="button" className={nv("btn ghost icon-btn")} aria-label={t("menuClose")} onClick={props.close}>
                        <Glyph name="x" />
                    </button>
                </div>
                <div className={nv("drawer-body")}>
                    {props.groups}
                    <div className={nv("cluster")} style={{ paddingTop: 16 }}>
                        <LocaleMenu />
                        <span className={nv("muted sm")}>{t("language")}</span>
                    </div>
                </div>
                <div className={nv("drawer-foot")}>
                    <a className={nv("btn outline md")} href={props.links.contactHref}>
                        {t("contact")}
                    </a>
                    <a className={nv("btn outline md")} href={props.links.signInHref}>
                        {t("signIn")}
                    </a>
                    <a className={nv("btn primary md")} href={props.links.tryHref}>
                        {t("try")}
                    </a>
                </div>
            </div>
        </div>
    )
}

/**
 * The sticky glass top bar of the public site: three mega menus (click or hover; ArrowDown enters, Escape closes and returns focus),
 * the round language switch, contact and sign-in, and the one red try button that shows only while no other primary CTA is on screen.
 */
export const HomeHeader = (props: { readonly links: HomeLinks }) => {
    const t = useTranslations("home")
    const links = props.links
    const [menu, setMenu] = useState<MenuName | null>(null)
    const [drawer, setDrawer] = useState(false)
    const [ctaHidden, setCtaHidden] = useState(props.links.anchorBase === "")
    const hover = useRef<number | undefined>(undefined)
    const header = useRef<HTMLElement>(null)
    const drawerOpener = useRef<HTMLButtonElement>(null)

    const close = useCallback(() => setMenu(null), [])
    const closeDrawer = useCallback(() => {
        setDrawer(false)
        drawerOpener.current?.focus()
    }, [])

    useEffect(() => {
        const away = (event: MouseEvent) => {
            if (header.current !== null && !header.current.contains(event.target as Node)) setMenu(null)
        }
        const escape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== "Escape") return
            setMenu((current) => {
                if (current !== null) header.current?.querySelector<HTMLButtonElement>(`[data-menu="${current}"]`)?.focus()
                return null
            })
            setDrawer((current) => {
                if (current) drawerOpener.current?.focus()
                return false
            })
        }
        document.addEventListener("click", away)
        document.addEventListener("keydown", escape)
        return () => {
            document.removeEventListener("click", away)
            document.removeEventListener("keydown", escape)
        }
    }, [])

    useEffect(() => {
        const targets = Array.from(document.querySelectorAll("[data-nv-cta]"))
        if (targets.length === 0) {
            setCtaHidden(false)
            return
        }
        const seen = new Set<Element>()
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) seen.add(entry.target)
                    else seen.delete(entry.target)
                }
                setCtaHidden(seen.size > 0)
            },
            { rootMargin: "-68px 0px 0px 0px" },
        )
        for (const target of targets) observer.observe(target)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        document.documentElement.style.overflow = drawer ? "hidden" : ""
    }, [drawer])

    const canHover = () => window.matchMedia("(hover: hover)").matches
    const enter = (name: MenuName) => {
        if (!canHover()) return
        window.clearTimeout(hover.current)
        hover.current = window.setTimeout(() => setMenu(name), 90)
    }
    const keyOnItem = (name: MenuName) => (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowDown") return
        event.preventDefault()
        setMenu(name)
        requestAnimationFrame(() => document.querySelector<HTMLAnchorElement>(`#nv-mega-${name} a`)?.focus())
    }

    const p = (key: string) => t(`megaPlatform.${key}`)
    const s = (key: string) => t(`megaSolutions.${key}`)
    const r = (key: string) => t(`megaResources.${key}`)
    const label: Record<MenuName, string> = { platform: t("navPlatform"), solutions: t("navSolutions"), resources: t("navResources") }

    const pick = () => {
        setMenu(null)
        setDrawer(false)
    }

    return (
        <>
            <header
                className={nv("topbar")}
                ref={header}
                onMouseLeave={() => {
                    window.clearTimeout(hover.current)
                    if (canHover()) close()
                }}
            >
                <div className={nv("col topbar-row")}>
                    <a className={nv("brand")} href={links.anchorBase === "" ? `#${SECTION.top}` : links.homeHref} aria-label={t("homeLabel")}>
                        <img src="/brand/nivo-logo.png" alt="NIVO" width={102} height={36} />
                    </a>
                    <nav className={nv("nav")} aria-label={t("navLabel")}>
                        {MENUS.map((name) => (
                            <button
                                key={name}
                                type="button"
                                className={nv("nav-item")}
                                data-menu={name}
                                aria-expanded={menu === name}
                                aria-controls={`nv-mega-${name}`}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    setMenu(menu === name ? null : name)
                                }}
                                onMouseEnter={() => enter(name)}
                                onKeyDown={keyOnItem(name)}
                            >
                                {label[name]} <Glyph name="chevron" />
                            </button>
                        ))}
                        <a className={nv("nav-item")} href={anchor(links, SECTION.pricing)} onMouseEnter={() => canHover() && close()}>
                            {t("navPricing")}
                        </a>
                    </nav>
                    <div className={nv("actions")}>
                        <LocaleMenu extra="only-wide" />
                        <a className={nv("btn ghost md only-wide hide-tablet")} href={links.contactHref}>
                            {t("contact")}
                        </a>
                        <a className={nv("btn ghost md only-wide")} href={links.signInHref}>
                            {t("signIn")}
                        </a>
                        <a className={nv("btn primary md only-wide header-cta")} data-hidden={ctaHidden} tabIndex={ctaHidden ? -1 : 0} href={links.tryHref}>
                            {t("try")}
                        </a>
                        <a className={nv("btn primary sm only-phone header-cta")} data-hidden={ctaHidden} tabIndex={ctaHidden ? -1 : 0} href={links.tryHref}>
                            {t("tryShort")}
                        </a>
                        <button
                            ref={drawerOpener}
                            type="button"
                            className={nv("btn ghost icon-btn only-phone")}
                            aria-label={t("menuOpen")}
                            aria-expanded={drawer}
                            onClick={() => setDrawer(true)}
                        >
                            <Glyph name="menu" />
                        </button>
                    </div>
                </div>

                <div className={nv("mega")} id="nv-mega-platform" data-open={menu === "platform"} aria-hidden={menu !== "platform"}>
                    <div className={nv("col mega-inner")}>
                        <div className={nv("mega-grid three")}>
                            <div className={nv("mega-col")}>
                                <div className={nv("sublabel")}>{p("agentsGroup")}</div>
                                <MegaLink href={anchor(links, SECTION.values)} icon="cpu" title={p("agentsTitle")} text={p("agentsText")} onPick={pick} />
                                <MegaLink href={anchor(links, SECTION.auto)} icon="hand" title={p("autoTitle")} text={p("autoText")} onPick={pick} />
                            </div>
                            <div className={nv("mega-col")}>
                                <div className={nv("sublabel")}>{p("workGroup")}</div>
                                <MegaLink href={anchor(links, SECTION.product)} icon="chat" title={p("chatTitle")} text={p("chatText")} onPick={pick} />
                                <MegaLink href={anchor(links, SECTION.product)} icon="desktop" title={p("deskTitle")} text={p("deskText")} onPick={pick} />
                            </div>
                            <div className={nv("mega-col")}>
                                <div className={nv("sublabel")}>{p("knowGroup")}</div>
                                <MegaLink href={anchor(links, SECTION.product)} icon="book" title={p("brainTitle")} text={p("brainText")} onPick={pick} />
                                <MegaLink href={anchor(links, SECTION.connect)} icon="link" title={p("connTitle")} text={p("connText")} onPick={pick} />
                            </div>
                        </div>
                        <div className={nv("mega-foot")}>
                            <span className={nv("muted")}>{p("devLabel")}</span>
                            <a className={nv("link-fg")} href={anchor(links, SECTION.connect)} onClick={pick}>
                                {p("devLink")} <Glyph name="arrow" extra="s16 arrow" />
                            </a>
                        </div>
                    </div>
                </div>

                <div className={nv("mega")} id="nv-mega-solutions" data-open={menu === "solutions"} aria-hidden={menu !== "solutions"}>
                    <div className={nv("col mega-inner")}>
                        <div className={nv("mega-grid feature")}>
                            <a className={nv("mega-feature")} href={anchor(links, SECTION.how)} onClick={pick}>
                                <span className={nv("eyebrow")}>{s("featured")}</span>
                                <div className={nv("stack g4")}>
                                    <span className={nv("h3")}>{s("salesTitle")}</span>
                                    <span className={nv("sm muted")}>{s("salesText")}</span>
                                </div>
                                <div className={nv("chain")}>
                                    <span className={nv("badge")}>{s("chain1")}</span>
                                    <Glyph name="arrow" />
                                    <span className={nv("badge")}>{s("chain2")}</span>
                                    <Glyph name="arrow" />
                                    <span className={nv("badge")}>{s("chain3")}</span>
                                    <Glyph name="arrow" />
                                    <span className={nv("badge")}>{s("chain4")}</span>
                                </div>
                                <span className={nv("link-fg")}>
                                    {s("salesLink")} <Glyph name="arrow" extra="s16 arrow" />
                                </span>
                            </a>
                            <div className={nv("mega-col")}>
                                <div className={nv("sublabel")}>{s("otherGroup")}</div>
                                <MegaLink href={anchor(links, SECTION.values)} icon="lifebuoy" title={s("careTitle")} text={s("careText")} onPick={pick} />
                                <MegaLink href={anchor(links, SECTION.values)} icon="banknotes" title={s("accTitle")} text={s("accText")} onPick={pick} />
                            </div>
                        </div>
                        <div className={nv("mega-foot")}>
                            <span className={nv("muted")}>{s("footText")}</span>
                            <a className={nv("link-fg")} href={links.contactHref}>
                                {t("contact")} <Glyph name="arrow" extra="s16 arrow" />
                            </a>
                        </div>
                    </div>
                </div>

                <div className={nv("mega")} id="nv-mega-resources" data-open={menu === "resources"} aria-hidden={menu !== "resources"}>
                    <div className={nv("col mega-inner")}>
                        <div className={nv("mega-grid two")}>
                            <div className={nv("mega-col")}>
                                <div className={nv("sublabel")}>{r("supportGroup")}</div>
                                <MegaLink href={anchor(links, SECTION.faq)} icon="question" title={r("faq")} onPick={pick} />
                                <MegaLink href={links.contactHref} icon="mail" title={r("contact")} onPick={pick} />
                            </div>
                            <div className={nv("mega-col")}>
                                <div className={nv("sublabel")}>{r("companyGroup")}</div>
                                <MegaLink href={links.privacyHref} icon="shield" title={r("privacy")} onPick={pick} />
                                <MegaLink href={links.termsHref} icon="doc" title={r("terms")} onPick={pick} />
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <Drawer
                links={links}
                open={drawer}
                close={closeDrawer}
                groups={
                    <>
                        <details>
                            <summary>
                                {label.platform} <Glyph name="chevron" extra="s16" />
                            </summary>
                            <a href={anchor(links, SECTION.values)} onClick={pick}>{p("agentsTitle")}</a>
                            <a href={anchor(links, SECTION.auto)} onClick={pick}>{p("autoTitle")}</a>
                            <a href={anchor(links, SECTION.product)} onClick={pick}>{p("chatTitle")}</a>
                            <a href={anchor(links, SECTION.product)} onClick={pick}>{p("deskTitle")}</a>
                            <a href={anchor(links, SECTION.product)} onClick={pick}>{p("brainTitle")}</a>
                            <a href={anchor(links, SECTION.connect)} onClick={pick}>{p("connTitle")}</a>
                        </details>
                        <details>
                            <summary>
                                {label.solutions} <Glyph name="chevron" extra="s16" />
                            </summary>
                            <a href={anchor(links, SECTION.how)} onClick={pick}>{s("salesTitle")}</a>
                            <a href={anchor(links, SECTION.values)} onClick={pick}>{s("careTitle")}</a>
                            <a href={anchor(links, SECTION.values)} onClick={pick}>{s("accTitle")}</a>
                        </details>
                        <details>
                            <summary>
                                {label.resources} <Glyph name="chevron" extra="s16" />
                            </summary>
                            <a href={anchor(links, SECTION.faq)} onClick={pick}>{r("faq")}</a>
                            <a href={links.privacyHref}>{r("privacy")}</a>
                            <a href={links.termsHref}>{r("terms")}</a>
                        </details>
                        <a className={nv("row")} href={anchor(links, SECTION.pricing)} onClick={pick}>
                            {t("navPricing")}
                        </a>
                    </>
                }
            />
        </>
    )
}
