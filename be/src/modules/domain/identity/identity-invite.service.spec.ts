import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { FakeClock, fakeIds, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { MAILER, MAIL_SETTINGS } from "@modules/integrations/mail"
import type { MailOptions, Mailer } from "@modules/integrations/mail"
import { digestOf } from "@modules/integrations/passport"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { IDS } from "@modules/platform/ids"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { keptEffectsLedger } from "@tests/fixtures/builders/kept-effects.builder"
import { accountByEmailRow as account } from "@tests/fixtures/builders/identity.builder"
import { IdentityInviteService } from "./identity-invite.service"
import { IDENTITY_AUTH_OPTIONS } from "./identity-auth.decorators"
import { IdentityAuthLogEvent } from "./identity-auth.log-events"
import type { IdentityAuthOptions } from "./identity-auth.options"
import { IdentityEmailTokenEntity } from "./persistence/entities"

/** The statements `callDbFunction` sends for the account doors the invitation uses. */
const USER_BY_EMAIL = 'SELECT * FROM "public"."be_auth_user_by_email"($1)'
const CREATE_USER = 'SELECT * FROM "public"."be_auth_create_user"($1, $2, $3, $4, $5, $6)'

const CREATED = "00000000-0000-4000-8000-000000000001"
const AT = "2026-02-03T04:05:06.000Z"
const NOW = new Date(AT)
const REDIRECT = "https://app.example.test/auth/confirm?next=%2Finvite%2Ftoken-1"
const OPTIONS: IdentityAuthOptions = { inviteTtlSeconds: 7200 }
const SETTINGS = mock<MailOptions>({
    webOrigin: "https://app.example.test",
    brandName: "Acme",
    defaultLanguage: "en",
    confirmTtlSeconds: 86_400,
    resetTtlSeconds: 3_600,
})

const build = async (query: ReadonlyArray<readonly [string, unknown]>, ledger: ReturnType<typeof keptEffectsLedger> | null = null) => {
    const entityManager: MockEntityManager = mockEntityManager({
        query,
        insert: [IdentityEmailTokenEntity, {}],
        update: [IdentityEmailTokenEntity, {}],
    })
    fakeTransaction(entityManager)
    const mailer = mock<Mailer>()
    mailer.send.mockResolvedValue({ messageId: "<m>", accepted: ["a@example.test"] })
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            IdentityInviteService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: MAILER, useValue: mailer },
            { provide: MAIL_SETTINGS, useValue: SETTINGS },
            { provide: CLOCK, useValue: new FakeClock(AT) },
            { provide: IDS, useValue: fakeIds() },
            { provide: IDENTITY_AUTH_OPTIONS, useValue: OPTIONS },
            { provide: LOGGER, useValue: logger },
            ...(ledger === null ? [] : ledger.providers),
        ],
    }).compile()
    return { subject: moduleRef.get(IdentityInviteService), mailer, logger, entityManager }
}

describe("IdentityInviteService.deliver", () => {
    it("mails a person who already has an account the invitation link on the web origin", async () => {
        const { subject, mailer, entityManager } = await build([[USER_BY_EMAIL, [account()]]])

        await expect(subject.deliver("An@Example.test", REDIRECT)).resolves.toBe("existing")

        const sent = mailer.send.mock.calls[0]?.[0]
        expect(sent?.to).toBe("an@example.test")
        expect(sent?.message.text).toContain("https://app.example.test/invite/token-1")
        expect(entityManager.insert).not.toHaveBeenCalled()
    })

    it("creates an account for a new person and mails a link to set a password that continues to the invitation", async () => {
        const { subject, mailer, entityManager } = await build([
            [USER_BY_EMAIL, []],
            [CREATE_USER, [{ be_auth_create_user: CREATED }]],
        ])

        await expect(subject.deliver("new@example.test", REDIRECT)).resolves.toBe("invited")

        expect(entityManager.query).toHaveBeenCalledWith(CREATE_USER, [
            CREATED,
            "new@example.test",
            null,
            false,
            "{}",
            NOW,
        ])
        const sent = mailer.send.mock.calls[0]?.[0]
        const url = new URL(/https:\/\/[^\s"<]+/u.exec(sent?.message.text ?? "")?.[0] ?? "")
        const token = url.searchParams.get("token") ?? ""
        expect(url.pathname).toBe("/auth/reset")
        expect(url.searchParams.get("next")).toBe("/invite/token-1")
        expect(token).toHaveLength(64)
        expect(sent?.message.text).toContain("2 hours")
        expect(entityManager.update).toHaveBeenCalledWith(
            IdentityEmailTokenEntity,
            expect.objectContaining({ userId: CREATED, purpose: "reset" }),
            { usedAt: NOW },
        )
        expect(entityManager.insert).toHaveBeenCalledWith(
            IdentityEmailTokenEntity,
            expect.objectContaining({
                userId: CREATED,
                purpose: "reset",
                tokenHash: digestOf(token),
                expiresAt: new Date(NOW.getTime() + 7_200_000),
                usedAt: null,
            }),
        )
    })

    it("continues to the path of the link itself when it carries no next value", async () => {
        const { subject, mailer } = await build([
            [USER_BY_EMAIL, []],
            [CREATE_USER, [{ be_auth_create_user: CREATED }]],
        ])

        await expect(subject.deliver("new@example.test", "https://app.example.test/invite/token-2?x=1")).resolves.toBe(
            "invited",
        )

        const url = new URL(/https:\/\/[^\s"<]+/u.exec(mailer.send.mock.calls[0]?.[0].message.text ?? "")?.[0] ?? "")
        expect(url.searchParams.get("next")).toBe("/invite/token-2?x=1")
    })
})

describe("IdentityInviteService.deliver refusals", () => {
    it("falls back to the root when the invitation address is not a link, and answers none when the account is not created", async () => {
        const { subject, mailer } = await build([
            [USER_BY_EMAIL, []],
            [CREATE_USER, []],
        ])

        await expect(subject.deliver("x@example.test", "not a url")).resolves.toBe("none")

        expect(mailer.send).not.toHaveBeenCalled()
    })

    it("answers none and logs when the mail cannot be sent", async () => {
        const { subject, mailer, logger } = await build([[USER_BY_EMAIL, [account()]]])
        const failure = new Error("smtp down")
        mailer.send.mockRejectedValue(failure)

        await expect(subject.deliver("an@example.test", "not a url")).resolves.toBe("none")

        expect(logger.error).toHaveBeenCalledWith(IdentityAuthLogEvent.MailFailed, failure, { kind: "invite" })
    })
})

describe("IdentityInviteService.deliverOnce", () => {
    const NEW_PERSON: ReadonlyArray<readonly [string, unknown]> = [
        [USER_BY_EMAIL, []],
        [CREATE_USER, [{ be_auth_create_user: CREATED }]],
    ]

    it("makes the plan and sends the mail once under the job's key; a run again makes no second account link and sends nothing", async () => {
        const ledger = keptEffectsLedger()
        const { subject, mailer, entityManager } = await build(NEW_PERSON, ledger)

        await expect(subject.deliverOnce("job-1", "new@example.test", REDIRECT)).resolves.toBe("invited")
        await expect(subject.deliverOnce("job-1", "new@example.test", REDIRECT)).resolves.toBe("invited")

        expect(mailer.send).toHaveBeenCalledTimes(1)
        expect(entityManager.insert).toHaveBeenCalledTimes(1)
        expect(ledger.keys()).toEqual(["job-1:plan", "job-1:mail"])
        expect(ledger.rows.get("job-1:plan")?.acts).toBe(1)
    })

    it("a mail whose outcome was lost is sent again with the SAME link (the plan was kept), never with a second account link", async () => {
        const ledger = keptEffectsLedger()
        const { subject, mailer, entityManager } = await build(NEW_PERSON, ledger)
        ledger.loseNext("job-1:mail", Object.assign(new Error("killed"), { code: "ECONNRESET" }))

        await expect(subject.deliverOnce("job-1", "new@example.test", REDIRECT)).rejects.toMatchObject({ code: "ECONNRESET" })
        await expect(subject.deliverOnce("job-1", "new@example.test", REDIRECT)).resolves.toBe("invited")

        expect(mailer.send).toHaveBeenCalledTimes(2)
        expect(mailer.send.mock.calls[1]?.[0].message.text).toBe(mailer.send.mock.calls[0]?.[0].message.text)
        expect(entityManager.insert).toHaveBeenCalledTimes(1)
        expect(ledger.rows.get("job-1:plan")?.acts).toBe(1)
    })

    it("sends a known person the invitation link once and answers existing", async () => {
        const ledger = keptEffectsLedger()
        const { subject, mailer } = await build([[USER_BY_EMAIL, [account()]]], ledger)

        await expect(subject.deliverOnce("job-1", "An@Example.test", REDIRECT)).resolves.toBe("existing")

        expect(mailer.send.mock.calls[0]?.[0].message.text).toContain("https://app.example.test/invite/token-1")
    })

    it("hands a pending account (made for an invitation, never used) a fresh password link instead of the plain link", async () => {
        const ledger = keptEffectsLedger()
        const { subject, mailer } = await build([[USER_BY_EMAIL, [account("invited")]]], ledger)

        await expect(subject.deliverOnce("job-1", "an@example.test", REDIRECT)).resolves.toBe("invited")

        expect(mailer.send.mock.calls[0]?.[0].message.text).toContain("/auth/reset?token=")
    })

    it("THROWS when the mail cannot be sent: nothing is swallowed as a delivery of none, and the plan stays kept", async () => {
        const ledger = keptEffectsLedger()
        const { subject, mailer, logger } = await build(NEW_PERSON, ledger)
        mailer.send.mockRejectedValueOnce(Object.assign(new Error("smtp down"), { code: "ECONNREFUSED" }))

        await expect(subject.deliverOnce("job-1", "new@example.test", REDIRECT)).rejects.toMatchObject({ code: "ECONNREFUSED" })

        expect(logger.error).not.toHaveBeenCalled()
        expect(ledger.rows.get("job-1:plan")?.done).toBe(true)
        expect(ledger.rows.has("job-1:mail")).toBe(false)
    })

    it("refuses typed (config) in an app that composes no effects ledger", async () => {
        const { subject } = await build(NEW_PERSON)

        await expect(subject.deliverOnce("job-1", "new@example.test", REDIRECT)).rejects.toMatchObject({ code: "IDENTITY_CONFIG_EFFECTS_MISSING" })
    })
})
