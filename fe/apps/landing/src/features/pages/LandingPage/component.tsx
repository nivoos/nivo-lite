import { HomeChrome } from "@/components/home/HomeChrome"
import { HomeSections } from "@/components/home/HomeSections"

/** The name of the page's main region. */
interface LandingPageBaseProps {
    readonly props: {
        readonly mainLabel: string
    }
}

/** The public home page of nivo.vn: the approved design (the landing may bend the console's design laws; Grammar tokens stay the base). */
export const LandingPageBase = (props: LandingPageBaseProps) => (
    <HomeChrome onHome mainLabel={props.props.mainLabel}>
        <HomeSections />
    </HomeChrome>
)
