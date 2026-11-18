import type { Metadata } from "next"
import { notFound } from "next/navigation"

/** An address no page owns is not for search results. */
export const metadata: Metadata = { robots: { index: false } }

/** Any address under a locale that no page owns: it answers 404 instead of drawing the loading shell. */
const Page = (): never => notFound()

export default Page
