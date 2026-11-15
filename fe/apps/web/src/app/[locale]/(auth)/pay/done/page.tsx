import { PayDonePage } from "@/features/pages/PayDonePage"

export { payDoneMetadata as generateMetadata } from "@/features/pages/PayDonePage"

type PageProps = Parameters<typeof PayDonePage>[0]

/** Public page the payment provider sends the payer's browser back to. */
const Page = (props: PageProps) => <PayDonePage searchParams={props.searchParams} />

export default Page
