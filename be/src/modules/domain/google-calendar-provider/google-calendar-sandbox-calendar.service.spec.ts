import { readFileSync } from "node:fs"
import { mock } from "@starci/jest-preset"
import type { GoogleTokensService } from "@modules/domain/google-connections"
import { GoogleCalendarError, GoogleCalendarErrorCode, type GoogleCalendarClient } from "@modules/integrations/google-calendar"
import type { ErrorParams } from "@modules/platform/errors"
import type { CalendarEventRequest } from "@modules/domain/provider-registry"
import { proofOf, providerRefusalDetail, providerRefusalReason } from "@modules/domain/provider-registry"
import { ProviderSandboxError, ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import { GCAL_CASE, GCAL_SANDBOX_CATALOGUE, GCAL_SANDBOX_EVENTS } from "./google-calendar-sandbox.catalogue"
import { GoogleCalendarSandboxService } from "./google-calendar-sandbox-calendar.service"
import { GoogleCalendarCredentialService } from "./google-calendar-credential.service"
import { GoogleCalendarService } from "./google-calendar.service"

const build = () => {
    const account = sandboxAccount({ provider: "google" })
    const { sandbox } = sandboxServiceOf(account)
    const connection = connectionRecord({ provider: "google", id: account.id, workspaceId: account.workspaceId, sandbox: true })
    return { account, sandbox, connection, calendar: new GoogleCalendarSandboxService(sandbox) }
}

const failure = (work: Promise<unknown>): Promise<unknown> => Promise.resolve(work.then(() => undefined, (cause: unknown) => cause))
const WEEK = { windowStart: "2026-11-16T00:00:00+07:00", windowEnd: "2026-11-23T00:00:00+07:00", timeZone: null }
const query = (calendarId: string | null = null) => ({ calendarId, ...WEEK })
const made = (overrides: Partial<CalendarEventRequest> = {}): CalendarEventRequest => ({
    calendarId: null,
    eventId: null,
    summary: "Hẹn tư vấn",
    description: null,
    location: null,
    start: { dateTime: "2026-11-18T14:00:00+07:00", timeZone: null },
    end: { dateTime: "2026-11-18T15:00:00+07:00", timeZone: null },
    guests: null,
    notifyGuests: false,
    ...overrides,
})

describe("GoogleCalendarSandboxService", () => {
    it("answers the five fixed events of the week as busy, and only those overlapping a narrower window (GCAL-1)", async () => {
        const { calendar, connection } = build()

        const week = await calendar.busy(connection, query())
        expect(week.calendarId).toBe("primary")
        expect(week.busy).toEqual(GCAL_SANDBOX_EVENTS.map((one) => ({ start: one.start, end: one.end })))
        await expect(calendar.busy(connection, { calendarId: null, windowStart: "2026-11-17T00:00:00+07:00", windowEnd: "2026-11-18T00:00:00+07:00", timeZone: null })).resolves.toMatchObject({
            busy: [{ start: "2026-11-17T14:00:00+07:00", end: "2026-11-17T15:30:00+07:00" }],
        })
    })

    it("answers an empty calendar as free when the account picked GCAL-2, whatever the calendar id; the default answers the week again", async () => {
        const { calendar, connection, sandbox, account } = build()
        await sandbox.setNextCase(account, "busy", GCAL_CASE.empty)

        await expect(calendar.busy(connection, query("any-calendar"))).resolves.toEqual({ calendarId: "any-calendar", busy: [] })
        await sandbox.setNextCase(account, "busy", GCAL_CASE.week)
        expect((await calendar.busy(connection, query("primary"))).busy).toHaveLength(5)
    })

    it("makes an event into state with a running id, then it is busy until cancelled (GCAL-3)", async () => {
        const { calendar, connection } = build()

        const event = await calendar.createEvent(connection, made())
        expect(event).toEqual({
            calendarId: "primary",
            eventId: "sbev000001",
            status: "confirmed",
            link: "https://calendar.sandbox.test/event?eid=sbev000001",
            summary: "Hẹn tư vấn",
            start: "2026-11-18T14:00:00+07:00",
            end: "2026-11-18T15:00:00+07:00",
        })
        expect((await calendar.busy(connection, query())).busy).toContainEqual({ start: "2026-11-18T14:00:00+07:00", end: "2026-11-18T15:00:00+07:00" })
        await calendar.cancelEvent(connection, { calendarId: null, eventId: "sbev000001", notifyGuests: false })
        expect((await calendar.busy(connection, query())).busy).toHaveLength(5)
        await expect(calendar.createEvent(connection, made({ eventId: "own-id-1" }))).resolves.toMatchObject({ eventId: "own-id-1" })
    })

    it("refuses an event id that already exists as rejected duplicate, not_sent, and does not refuse overlapping times (GCAL-4)", async () => {
        const { calendar, connection } = build()

        const fixed = await failure(calendar.createEvent(connection, made({ eventId: "sbx-evt-giao-ban" })))
        expect(providerRefusalReason(fixed)).toBe("rejected")
        expect(providerRefusalDetail(fixed)).toBe("The requested identifier already exists.")
        expect(proofOf(fixed)).toBe("not_sent")
        await calendar.createEvent(connection, made({ eventId: "mine", start: { dateTime: "2026-11-16T09:00:00+07:00", timeZone: null } }))
        expect(providerRefusalReason(await failure(calendar.createEvent(connection, made({ eventId: "mine" }))))).toBe("rejected")
    })

    it("changes only what is set, on a fixed event and on a made one; an unknown or cancelled event is not found (GCAL-5)", async () => {
        const { calendar, connection } = build()
        const change = { calendarId: null, eventId: "sbx-evt-giao-ban", summary: "Họp giao ban (dời)", description: null, location: null, start: { dateTime: "2026-11-16T11:00:00+07:00", timeZone: null }, end: null, guests: null, notifyGuests: false }

        await expect(calendar.updateEvent(connection, change)).resolves.toMatchObject({ eventId: "sbx-evt-giao-ban", summary: "Họp giao ban (dời)", start: "2026-11-16T11:00:00+07:00", end: "2026-11-16T10:00:00+07:00" })
        expect(providerRefusalReason(await failure(calendar.updateEvent(connection, { ...change, eventId: "nope" })))).toBe("not_found")
        await calendar.cancelEvent(connection, { calendarId: null, eventId: "sbx-evt-giao-ban", notifyGuests: false })
        expect(providerRefusalReason(await failure(calendar.updateEvent(connection, change)))).toBe("not_found")
    })

    it("cancels once, answers cancelled false the second time, and not found for an unknown event (GCAL-6)", async () => {
        const { calendar, connection } = build()
        const cancel = (eventId: string) => calendar.cancelEvent(connection, { calendarId: null, eventId, notifyGuests: true })

        await expect(cancel("sbx-evt-khach-hang")).resolves.toEqual({ calendarId: "primary", eventId: "sbx-evt-khach-hang", cancelled: true })
        await expect(cancel("sbx-evt-khach-hang")).resolves.toMatchObject({ cancelled: false })
        const error = await failure(cancel("nope"))
        expect(providerRefusalReason(error)).toBe("not_found")
        expect(proofOf(error)).toBe("not_sent")
        expect((await calendar.busy(connection, query())).busy).toHaveLength(4)
    })

    it("GCAL-7 / GCAL-8: the picked case of an operation refuses it, never the calendar id: no id of the request picks a case any more", async () => {
        const { calendar, connection, sandbox, account } = build()

        // The old magic ids answer like any other id now: nothing is refused until the account picks a case.
        for (const id of ["calendar-het-han", "calendar-khong-co", "calendar-trong"]) {
            await expect(calendar.busy(connection, query(id))).resolves.toMatchObject({ calendarId: id })
        }
        for (const [caseId, reason] of [
            [GCAL_CASE.busyAuthRefused, "auth_refused"],
            [GCAL_CASE.busyNotFound, "not_found"],
        ] as const) {
            await sandbox.setNextCase(account, "busy", caseId)
            const error = await failure(calendar.busy(connection, query("primary")))
            expect(providerRefusalReason(error)).toBe(reason)
            expect(proofOf(error)).toBe("not_sent")
        }
    })

    it("every operation has its own refusal, throttle and no-answer cases; the throttle proves not_sent, the cut proves unknown, as the live adapter proves them", async () => {
        const { calendar, connection, sandbox, account } = build()
        const change = { calendarId: null, eventId: "sbx-evt-giao-ban", summary: "x", description: null, location: null, start: null, end: null, guests: null, notifyGuests: false }
        const cancel = { calendarId: null, eventId: "sbx-evt-giao-ban", notifyGuests: false }
        const run = {
            busy: () => calendar.busy(connection, query()),
            createEvent: () => calendar.createEvent(connection, made()),
            updateEvent: () => calendar.updateEvent(connection, change),
            cancelEvent: () => calendar.cancelEvent(connection, cancel),
        }
        const plan = [
            ["busy", GCAL_CASE.busyAuthRefused, "auth_refused", "not_sent"],
            ["busy", GCAL_CASE.busyRateLimited, null, "not_sent"],
            ["busy", GCAL_CASE.busyNoAnswer, null, "unknown"],
            ["createEvent", GCAL_CASE.createAuthRefused, "auth_refused", "not_sent"],
            ["createEvent", GCAL_CASE.duplicate, "rejected", "not_sent"],
            ["createEvent", GCAL_CASE.createRateLimited, null, "not_sent"],
            ["createEvent", GCAL_CASE.createNoAnswer, null, "unknown"],
            ["updateEvent", GCAL_CASE.updateAuthRefused, "auth_refused", "not_sent"],
            ["updateEvent", GCAL_CASE.updateNotFound, "not_found", "not_sent"],
            ["updateEvent", GCAL_CASE.updateRateLimited, null, "not_sent"],
            ["updateEvent", GCAL_CASE.updateNoAnswer, null, "unknown"],
            ["cancelEvent", GCAL_CASE.cancelAuthRefused, "auth_refused", "not_sent"],
            ["cancelEvent", GCAL_CASE.cancelNotFound, "not_found", "not_sent"],
            ["cancelEvent", GCAL_CASE.cancelRateLimited, null, "not_sent"],
            ["cancelEvent", GCAL_CASE.cancelNoAnswer, null, "unknown"],
        ] as const
        for (const [operation, caseId, reason, proof] of plan) {
            await sandbox.setNextCase(account, operation, caseId)
            const error = await failure(run[operation]())
            expect([caseId, providerRefusalReason(error), proofOf(error)]).toEqual([caseId, reason, proof])
        }
    })

    it("GCAL-14 / 25 / 26: the call applies its effect and then gives no answer: the event stays (made, changed, cancelled) while the caller hears the cut (proof unknown)", async () => {
        const { calendar, connection, sandbox, account } = build()

        await sandbox.setNextCase(account, "createEvent", GCAL_CASE.createAppliedNoAnswer)
        const cut = await failure(calendar.createEvent(connection, made({ eventId: "lost-answer" })))
        expect(proofOf(cut)).toBe("unknown")
        await sandbox.setNextCase(account, "createEvent", GCAL_CASE.created)
        // The event is there: the free / busy read finds it, and making it again is refused duplicate (the live 409): the unknown outcome can be told apart.
        expect((await calendar.busy(connection, query())).busy).toContainEqual({ start: "2026-11-18T14:00:00+07:00", end: "2026-11-18T15:00:00+07:00" })
        expect(providerRefusalReason(await failure(calendar.createEvent(connection, made({ eventId: "lost-answer" }))))).toBe("rejected")

        await sandbox.setNextCase(account, "updateEvent", GCAL_CASE.updateAppliedNoAnswer)
        const change = { calendarId: null, eventId: "sbx-evt-giao-ban", summary: "Dời giờ", description: null, location: null, start: null, end: null, guests: null, notifyGuests: false }
        expect(proofOf(await failure(calendar.updateEvent(connection, change)))).toBe("unknown")
        await sandbox.setNextCase(account, "updateEvent", GCAL_CASE.updated)
        await expect(calendar.updateEvent(connection, { ...change, summary: null })).resolves.toMatchObject({ summary: "Dời giờ" })

        await sandbox.setNextCase(account, "cancelEvent", GCAL_CASE.cancelAppliedNoAnswer)
        const cancel = { calendarId: null, eventId: "sbx-evt-khach-hang", notifyGuests: false }
        expect(proofOf(await failure(calendar.cancelEvent(connection, cancel)))).toBe("unknown")
        await sandbox.setNextCase(account, "cancelEvent", GCAL_CASE.cancelled)
        await expect(calendar.cancelEvent(connection, cancel)).resolves.toMatchObject({ cancelled: false })
    })

    it("GCAL-23 / GCAL-24: a revoked grant and a refresh that cannot reach Google leave no request out (not sent), with the errors the token store throws", async () => {
        const { calendar, connection, sandbox, account } = build()

        await sandbox.setNextCase(account, "busy", GCAL_CASE.busyGrantRevoked)
        const revoked = await failure(calendar.busy(connection, query()))
        expect(revoked).toMatchObject({ code: "GOOGLE_CONNECTIONS_LOST" })
        expect(proofOf(revoked)).toBe("not_sent")

        await sandbox.setNextCase(account, "busy", GCAL_CASE.busyRefreshUnreachable)
        const refresh = await failure(calendar.busy(connection, query()))
        expect(refresh).toMatchObject({ code: "GOOGLE_UNREACHABLE" })
        expect(proofOf(refresh)).toBe("not_sent")
    })

    it("answers what the LIVE adapter answers for the same Calendar answer: the same typed refusal, reason and proof (the twin)", async () => {
        const live = (code: GoogleCalendarErrorCode, params: ErrorParams) => {
            const tokens = mock<GoogleTokensService>()
            tokens.accessToken.mockResolvedValue("t")
            tokens.withRetry.mockImplementation(async (token, work) => work(await token(false)))
            const client = mock<GoogleCalendarClient>()
            client.freeBusy.mockRejectedValue(new GoogleCalendarError({ code, params }))
            return new GoogleCalendarService(client, new GoogleCalendarCredentialService(tokens)).busy(connectionRecord({ provider: "google", meta: { calendar: "granted" } }), query())
        }
        const { calendar, connection, sandbox, account } = build()
        const cases = [
            [GCAL_CASE.busyAuthRefused, GoogleCalendarErrorCode.AuthFailed, { status: 401, reason: "authError", detail: "Invalid Credentials" }],
            [GCAL_CASE.busyRateLimited, GoogleCalendarErrorCode.RateLimited, { status: 429, reason: "rateLimitExceeded", detail: "Rate Limit Exceeded" }],
            [GCAL_CASE.busyNoAnswer, GoogleCalendarErrorCode.Unreachable, {}],
            [GCAL_CASE.busyNotFound, GoogleCalendarErrorCode.NotFound, { status: 404, reason: "notFound", detail: "Not Found" }],
        ] as const
        for (const [caseId, code, params] of cases) {
            await sandbox.setNextCase(account, "busy", caseId)
            const sandboxed = await failure(calendar.busy(connection, query()))
            const liveOne = await failure(live(code, params))
            expect([caseId, Reflect.get(sandboxed as object, "code"), proofOf(sandboxed), providerRefusalReason(sandboxed)]).toEqual([
                caseId,
                Reflect.get(liveOne as object, "code"),
                proofOf(liveOne),
                providerRefusalReason(liveOne),
            ])
        }
    })

    it("every case is tagged with an outcome, each operation has exactly one default and it is tagged ok; the old magic calendar ids are gone from the catalogue", () => {
        const byOperation = Object.groupBy(GCAL_SANDBOX_CATALOGUE.cases, (one) => one.operation ?? "")
        expect(Object.keys(byOperation).toSorted()).toEqual(["busy", "cancelEvent", "createEvent", "updateEvent"])
        for (const cases of Object.values(byOperation)) {
            expect(cases?.filter((one) => one.default === true).map((one) => one.outcome)).toEqual(["ok"])
            expect(cases?.every((one) => one.outcome !== undefined)).toBe(true)
        }
        const source = readFileSync(__filename.replace("-calendar.service.spec.ts", ".catalogue.ts"), "utf8")
        for (const word of ["calendar-trong", "calendar-het-han", "calendar-khong-co"]) expect(source).not.toContain(word)
    })

    it("takes one logged call per request with the live operation names", async () => {
        const { calendar, connection, sandbox, account } = build()

        await calendar.busy(connection, query())
        await calendar.createEvent(connection, made())
        await calendar.updateEvent(connection, { calendarId: null, eventId: "sbev000001", summary: "x", description: null, location: null, start: null, end: null, guests: null, notifyGuests: false })
        await calendar.cancelEvent(connection, { calendarId: null, eventId: "sbev000001", notifyGuests: false })

        expect((await sandbox.calls(account)).map((call) => [call.operation, call.key])).toEqual([
            ["busy", "primary"],
            ["createEvent", ""],
            ["updateEvent", "sbev000001"],
            ["cancelEvent", "sbev000001"],
        ])
    })

    it("is deterministic: two fresh accounts answer the same", async () => {
        const one = build()
        const two = build()

        expect(await one.calendar.busy(one.connection, query())).toEqual(await two.calendar.busy(two.connection, query()))
        expect(await one.calendar.createEvent(one.connection, made())).toEqual(await two.calendar.createEvent(two.connection, made()))
    })

    it("refuses a live account and a switched-off sandbox", async () => {
        const { calendar } = build()
        const live = await failure(calendar.busy(connectionRecord({ provider: "google", id: "live-1" }), query()))
        expect(live).toBeInstanceOf(ProviderSandboxError)
        expect((live as ProviderSandboxError).code).toBe(ProviderSandboxErrorCode.LiveAccount)

        const account = sandboxAccount({ provider: "google" })
        const off = new GoogleCalendarSandboxService(sandboxServiceOff(account).sandbox)
        const refused = await failure(off.busy(connectionRecord({ provider: "google", id: account.id, sandbox: true }), query()))
        expect((refused as ProviderSandboxError).code).toBe(ProviderSandboxErrorCode.Off)
    })

    it("has a catalogue of unique GCAL-<n> ids, and no inbound case (the calendar is read and written, never calling back)", () => {
        const ids = GCAL_SANDBOX_CATALOGUE.cases.map((one) => one.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^GCAL-\d+$/.test(id))).toBe(true)
        expect(GCAL_SANDBOX_CATALOGUE.provider).toBe("google")
        expect(GCAL_SANDBOX_CATALOGUE.cases.every((one) => one.inbound === undefined)).toBe(true)
    })

    it("reaches no host: one constructor parameter and no integration or network word in its source", () => {
        expect(GoogleCalendarSandboxService.length).toBe(1)
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toContain("http")
    })
})
