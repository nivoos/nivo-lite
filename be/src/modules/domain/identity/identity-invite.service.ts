import { Injectable, Optional } from "@nestjs/common"
import { IsNull, type EntityManager } from "typeorm"
import {
    InjectMailSettings,
    InjectMailer,
    type MailOptions,
    type Mailer,
    type RenderedMail,
} from "@modules/integrations/mail"
import { digestOf, normalizeEmail } from "@modules/integrations/passport"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectEffects, type Effects, type EffectResult } from "@modules/platform/effects"
import { InjectIds, type Ids } from "@modules/platform/ids"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { isRecord, sameSitePath } from "@modules/platform/primitives"
import { INVITE_MAIL_EFFECT, INVITE_PLAN_EFFECT } from "@modules/queues/invite-command"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import type { InviteSent } from "./identity-auth.contracts"
import { InjectIdentityAuthOptions } from "./identity-auth.decorators"
import { IdentityAuthLogEvent } from "./identity-auth.log-events"
import type { IdentityAuthOptions } from "./identity-auth.options"
import { inviteAccountMail, inviteExistingMail } from "./messages/identity-mail.messages"
import { accountDoors } from "./persistence/account-doors.port"
import { IdentityEmailTokenEntity } from "./persistence/entities"

const SECONDS_PER_HOUR = 3600
/** The purpose an invitation link is stored under: spending it is the reset door, which sets the first password and confirms the mailbox. */
const RESET = "reset"

/** Who an invitation mail goes to and with which link: the plan the mail effect sends, kept so a run again sends the same link. */
interface InviteMailPlan {
    /** `existing`: a link to the invitation for a known person; `invited`: a link to set a password first for a new one. */
    readonly kind: "existing" | "invited"
    /** The link in the mail. */
    readonly url: string
    /** How many hours the link of a new person lives. */
    readonly hours: number
}

/** The plan as the ledger keeps it (sealed: its link is a secret). */
const keptPlanOf = (plan: InviteMailPlan): EffectResult => ({ kind: plan.kind, url: plan.url, hours: plan.hours })

/** The plan a ledger row kept; a shape no code writes is refused. */
const planFrom = (kept: EffectResult): InviteMailPlan => {
    if (isRecord(kept) && (kept.kind === "existing" || kept.kind === "invited") && typeof kept.url === "string" && typeof kept.hours === "number") {
        return { kind: kept.kind, url: kept.url, hours: kept.hours }
    }
    throw new IdentityError({ code: IdentityErrorCode.AccountNotFound })
}

@Injectable()
/**
 * Delivers a workspace invitation by email: a new person gets an account with a single-use link to set a password and continue to the
 * invitation, a known person a link to the invitation. The link of a new person is a reset link with the longer invitation lifetime.
 */
export class IdentityInviteService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectMailer() private readonly mailer: Mailer,
        @InjectMailSettings() private readonly mailOptions: MailOptions,
        @InjectClock() private readonly clock: Clock,
        @InjectIds() private readonly ids: Ids,
        @InjectIdentityAuthOptions() private readonly options: IdentityAuthOptions,
        @InjectLogger() private readonly logger: Logger,
        @Optional() @InjectEffects() private readonly effects: Effects | null = null,
    ) {}

    /**
     * Emails the invitation of a job, exactly once under `key` (`<jobId>:<...>`): the plan (the account of a new person with its one
     * password link, or the link of a known person) is made and KEPT first, then the mail is sent as its own effect, so a run again after
     * a crash sends the same link and never makes a second account link that kills the first. A mail that cannot be sent THROWS (the
     * runner retries it, then parks it with one item); nothing is swallowed. Answers how the invitation reached the person.
     */
    async deliverOnce(key: string, email: string, redirectTo: string): Promise<InviteSent> {
        const effects = this.effects
        if (effects === null) throw new IdentityError({ code: IdentityErrorCode.EffectsMissing })
        const address = normalizeEmail(email)
        const next = this.nextPathOf(redirectTo)
        const plan = await effects.once(`${key}:plan`, INVITE_PLAN_EFFECT, {
            act: () => this.planOf(address, next),
            keep: keptPlanOf,
            from: planFrom,
            secret: true,
        })
        await effects.once(`${key}:mail`, INVITE_MAIL_EFFECT, {
            act: async () => {
                await this.send(address, this.mailOf(plan))
                return true
            },
            keep: () => true,
            from: () => true,
        })
        return plan.kind
    }

    /**
     * Emails the invitation. When the mail cannot be sent the delivery is `none` and the caller shows the link to copy. Never throws.
     * The mail is written in the default language of the mail settings.
     */
    async deliver(email: string, redirectTo: string): Promise<InviteSent> {
        try {
            const address = normalizeEmail(email)
            const next = this.nextPathOf(redirectTo)
            const known = await accountDoors.userByEmail(this.entityManager, address)
            if (known !== undefined) {
                await this.send(
                    address,
                    inviteExistingMail(this.mailOptions.defaultLanguage, {
                        brand: this.mailOptions.brandName,
                        url: `${this.mailOptions.webOrigin}${next}`,
                    }),
                )
                return "existing"
            }
            const created = await accountDoors.createUser(this.entityManager, {
                id: this.ids.next(),
                email: address,
                hash: null,
                confirmed: false,
                meta: "{}",
                now: this.clock.now(),
            })
            if (created === undefined) return "none"
            const token = await this.mint(created)
            const url = `${this.mailOptions.webOrigin}/auth/reset?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`
            const hours = Math.ceil(this.options.inviteTtlSeconds / SECONDS_PER_HOUR)
            await this.send(
                address,
                inviteAccountMail(this.mailOptions.defaultLanguage, { brand: this.mailOptions.brandName, url, hours }),
            )
            return "invited"
        } catch (cause) {
            this.logger.error(IdentityAuthLogEvent.MailFailed, cause, { kind: "invite" })
            return "none"
        }
    }

    /** Who the invitation goes to: a known person gets the link to the invitation; an account made for an invitation and not yet used (no password, no confirmed mailbox) or a new one gets a fresh password link. */
    private async planOf(address: string, next: string): Promise<InviteMailPlan> {
        const hours = Math.ceil(this.options.inviteTtlSeconds / SECONDS_PER_HOUR)
        const known = await accountDoors.userByEmail(this.entityManager, address)
        const unused = known?.encrypted_password === null && known.email_confirmed_at === null && !known.disabled ? known : undefined
        if (known !== undefined && unused === undefined) return { kind: "existing", url: `${this.mailOptions.webOrigin}${next}`, hours }
        const userId = unused?.id ?? (await this.createdOrFound(address))
        const token = await this.mint(userId)
        const url = `${this.mailOptions.webOrigin}/auth/reset?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`
        return { kind: "invited", url, hours }
    }

    /** The id of the account made for a new person; a lost race (the address was taken meanwhile) finds the account that won. */
    private async createdOrFound(address: string): Promise<string> {
        const created = await accountDoors.createUser(this.entityManager, {
            id: this.ids.next(),
            email: address,
            hash: null,
            confirmed: false,
            meta: "{}",
            now: this.clock.now(),
        })
        const found = created ?? (await accountDoors.userByEmail(this.entityManager, address))?.id
        if (found === undefined) throw new IdentityError({ code: IdentityErrorCode.AccountNotFound })
        return found
    }

    /** The mail a plan sends, in the default language of the mail settings. */
    private mailOf(plan: InviteMailPlan): RenderedMail {
        const brand = this.mailOptions.brandName
        const language = this.mailOptions.defaultLanguage
        return plan.kind === "existing"
            ? inviteExistingMail(language, { brand, url: plan.url })
            : inviteAccountMail(language, { brand, url: plan.url, hours: plan.hours })
    }

    private async send(to: string, message: RenderedMail): Promise<void> {
        await this.mailer.send({ to, message })
    }

    /** Stores a fresh single-use token for a person (older live ones stop working) and answers the plain token for the one link that carries it. */
    private async mint(userId: string): Promise<string> {
        const now = this.clock.now()
        const token = `${this.ids.next()}${this.ids.next()}`.replaceAll("-", "")
        await this.entityManager.transaction(async (scoped) => {
            await scoped.update(IdentityEmailTokenEntity, { userId, purpose: RESET, usedAt: IsNull() }, { usedAt: now })
            await scoped.insert(IdentityEmailTokenEntity, {
                id: this.ids.next(),
                userId,
                purpose: RESET,
                tokenHash: digestOf(token),
                expiresAt: new Date(now.getTime() + this.options.inviteTtlSeconds * 1000),
                usedAt: null,
                createdAt: now,
            })
        })
        return token
    }

    /** The same-site path the invitation link continues to: its `next` query value, else the path of the link itself, else the root. */
    private nextPathOf(redirectTo: string): string {
        if (!URL.canParse(redirectTo)) return "/"
        const url = new URL(redirectTo)
        return sameSitePath(url.searchParams.get("next") ?? `${url.pathname}${url.search}`, "/")
    }
}
