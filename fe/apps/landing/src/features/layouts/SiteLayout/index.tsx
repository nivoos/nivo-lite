import type { Metadata, Viewport } from "next"
import { getTranslations } from "next-intl/server"
import { Be_Vietnam_Pro, Inter } from "next/font/google"
import type { ReactNode } from "react"
import { siteUrl } from "@/modules/config"
import { SiteLayoutBase } from "./component"

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-sans" })
/** The display face of the public site's headings (Vietnamese marks drawn by the face itself, not synthesised). */
const display = Be_Vietnam_Pro({ subsets: ["latin", "vietnamese"], weight: ["600", "700", "800"], variable: "--font-display" })

type SiteLayoutProps = {
    readonly locale: string
    readonly content: ReactNode
}

/** The viewport of every page. */
export const siteLayoutViewport: Viewport = { width: "device-width", initialScale: 1 }

/** The localized document title and description. */
export const siteLayoutMetadata = async (locale: string): Promise<Metadata> => {
    const t = await getTranslations({ locale, namespace: "app" })
    return { title: t("title"), description: t("description"), metadataBase: new URL(siteUrl()) }
}

/** The server-resolved document around the routed body. */
export const SiteLayout = (props: SiteLayoutProps) => (
    <SiteLayoutBase props={{ lang: props.locale, fontClass: `${inter.variable} ${display.variable}` }}>{props.content}</SiteLayoutBase>
)
