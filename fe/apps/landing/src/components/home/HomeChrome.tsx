import { useLocale, useTranslations } from "next-intl"
import type { ReactNode } from "react"
import { HomeHeader } from "./HomeHeader"
import { HomeMotion } from "./HomeMotion"
import { SECTION, anchor, nv, type HomeLinks } from "./shared"
import { homeLinks } from "./useHomeLinks"

/** The white footer: brand and tagline, three link columns, the legal lines. */
const HomeFooter = (props: { readonly links: HomeLinks }) => {
    const t = useTranslations("home.footer")
    const links = props.links
    return (
        <footer className={nv("site-foot")} aria-label={t("aria")}>
            <div className={nv("col foot-grid")}>
                <div className={nv("stack g12")}>
                    <img src="/brand/nivo-logo.png" alt="NIVO" width={113} height={40} style={{ objectFit: "contain", objectPosition: "left" }} />
                    <span className={nv("tagline")}>{t.rich("tagline", { b: (chunks) => <b>{chunks}</b> })}</span>
                </div>
                <div className={nv("foot-cols")}>
                    <div>
                        <span className={nv("sublabel")}>{t("colProduct")}</span>
                        <ul>
                            <li><a href={anchor(links, SECTION.product)}>{t("platform")}</a></li>
                            <li><a href={anchor(links, SECTION.how)}>{t("how")}</a></li>
                            <li><a href={anchor(links, SECTION.pricing)}>{t("pricing")}</a></li>
                            <li><a href={links.tryHref}>{t("try")}</a></li>
                        </ul>
                    </div>
                    <div>
                        <span className={nv("sublabel")}>{t("colCompany")}</span>
                        <ul>
                            <li><a href={anchor(links, SECTION.philosophy)}>{t("principles")}</a></li>
                            <li><a href={links.contactHref}>{t("contact")}</a></li>
                        </ul>
                    </div>
                    <div>
                        <span className={nv("sublabel")}>{t("colSupport")}</span>
                        <ul>
                            <li><a href={anchor(links, SECTION.faq)}>{t("faq")}</a></li>
                            <li><a href={links.signInHref}>{t("signIn")}</a></li>
                            <li><a href={links.privacyHref}>{t("privacy")}</a></li>
                            <li><a href={links.termsHref}>{t("terms")}</a></li>
                        </ul>
                    </div>
                </div>
            </div>
            <div className={nv("col")}>
                <div className={nv("legal")}>
                    <span>{t("copyright")}</span>
                    <span className={nv("muted")}>{t("company")}</span>
                    <span className={nv("xs muted")}>{t("legalNote")}</span>
                </div>
            </div>
        </footer>
    )
}

/**
 * The public site's chrome (the approved nivo.vn design): skip link, glass header with mega menus, the page, the footer, and the one
 * motion driver (scroll reveal, pointer spotlight, magnetic buttons, the flow rail). `onHome` keeps the section links in-page.
 */
export const HomeChrome = (props: { readonly onHome: boolean; readonly mainLabel: string; readonly children: ReactNode }) => {
    const t = useTranslations("home")
    const links = homeLinks(useLocale(), props.onHome)
    return (
        <div className={nv("root")}>
            <noscript>
                <style>{".nv-rv{opacity:1!important;transform:none!important}.nv-step{opacity:1!important;transform:none!important}"}</style>
            </noscript>
            <a className={nv("skip")} href="#main">
                {t("skip")}
            </a>
            <HomeHeader links={links} />
            <main id="main" aria-label={props.mainLabel}>
                {props.children}
            </main>
            <HomeFooter links={links} />
            <HomeMotion />
        </div>
    )
}
