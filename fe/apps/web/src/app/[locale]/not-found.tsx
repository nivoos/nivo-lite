import { AppNotFoundPage } from "@/features/pages/AppNotFoundPage"

/** The document title of the 404 page. */
export { appNotFoundMetadata as generateMetadata } from "@/features/pages/AppNotFoundPage"

/** The locale segment's not-found slot. */
const NotFound = () => <AppNotFoundPage />

export default NotFound
