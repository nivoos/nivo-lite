import type { ReactElement } from "react"
import { SandboxPayPage } from "@/features/pages/SandboxPayPage"

/** The document title of this page. */
export { sandboxPayMetadata as generateMetadata } from "@/features/pages/SandboxPayPage"

type PageProps = { readonly params: Promise<{ linkId: string }> }

/** The pretend payment page a PayOS sandbox link opens: NIVO plays the payment page, so nothing here moves money. */
const Page = async (props: PageProps): Promise<ReactElement> => <SandboxPayPage linkId={(await props.params).linkId} />

export default Page
