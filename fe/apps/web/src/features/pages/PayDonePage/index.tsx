import type { ReactElement } from "react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { PayDonePageBase } from "./component"
import { payDoneStateOf, type PayDoneQuery } from "@/modules/payDone"

/** What the route passes through: the query the payment provider appended (read as exact words, never shown). */
interface PayDonePageProps {
    readonly searchParams: Promise<PayDoneQuery>
}

/** The document title of the page; the page is never indexed. */
export const payDoneMetadata = async (): Promise<Metadata> => {
    const t = await getTranslations("payDone")
    return { title: t("pageTitle"), robots: { index: false, follow: false } }
}

/** `/pay/done`: where a payer's browser lands after the payment page (paid or cancelled). Public, holds no data, claims no outcome. */
export const PayDonePage = async (props: PayDonePageProps): Promise<ReactElement> => {
    const state = payDoneStateOf(await props.searchParams)
    const t = await getTranslations("payDone")
    return (
        <PayDonePageBase
            props={{
                title: state === "cancelled" ? t("cancelledTitle") : t("returnedTitle"),
                text: state === "cancelled" ? t("cancelledText") : t("returnedText"),
                note: t("closeNote"),
            }}
        />
    )
}
