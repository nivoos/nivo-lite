import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { SandboxPayPanes } from "@/components/blocks/SandboxPayPanes"

/** What the route hands the page: the pay link of the address. */
type SandboxPayPageProps = {
    readonly linkId: string
}

/** The document title of the sandbox pay page. */
export const sandboxPayMetadata = async (): Promise<Metadata> => {
    const t = await getTranslations("sandbox")
    return { title: t("payTitle") }
}

/** The pretend payment page of a sandbox link: the same gate as the Sandbox page, one neutral notice in production. */
export const SandboxPayPage = (props: SandboxPayPageProps) => <SandboxPayPanes linkId={props.linkId} />

/** The same page while the route loads: the header stays real text, every card draws its own skeleton. */
export const SandboxPayLoadingPage = () => <SandboxPayPanes linkId="" />
