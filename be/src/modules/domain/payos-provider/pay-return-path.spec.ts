import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PAY_RETURN_PATH } from "./payos-payment-request.adapter"

const WEB = join(__dirname, "../../../../../fe/apps/web/src")

describe("the payer's return page", () => {
    it("is one address: be's PAY_RETURN_PATH is the web app's AUTH_ROUTES.payDone", () => {
        const routes = readFileSync(join(WEB, "modules/routes/auth-routes.ts"), "utf8")
        expect(routes).toContain(`payDone: "${PAY_RETURN_PATH}"`)
    })

    it("is served without a session: the web proxy lists it public", () => {
        const proxy = readFileSync(join(WEB, "proxy.ts"), "utf8")
        expect(proxy).toContain(`"${PAY_RETURN_PATH}",`)
    })

    it("has a page at that path in the web app", () => {
        const page = readFileSync(join(WEB, `app/[locale]/(auth)${PAY_RETURN_PATH}/page.tsx`), "utf8")
        expect(page).toContain("PayDonePage")
    })
})
