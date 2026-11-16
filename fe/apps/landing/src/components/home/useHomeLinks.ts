import { CONSOLE_PAGES, CONTACT_HREF, LANDING_ROUTES, appHref } from "@/modules/routes"
import type { HomeLinks } from "./shared"

/** The links of the home chrome in the reader's language; `onHome` keeps section links in-page. Pure: server and client both call it. */
export const homeLinks = (locale: string, onHome: boolean): HomeLinks => ({
    tryHref: appHref(CONSOLE_PAGES.signup, locale),
    signInHref: appHref(CONSOLE_PAGES.login, locale),
    contactHref: CONTACT_HREF,
    privacyHref: LANDING_ROUTES.privacy,
    termsHref: LANDING_ROUTES.terms,
    homeHref: LANDING_ROUTES.home,
    anchorBase: onHome ? "" : "/",
})
