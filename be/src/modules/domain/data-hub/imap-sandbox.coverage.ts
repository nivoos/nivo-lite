import type { SandboxCoverage, SandboxRoleCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * THE MAILBOX'S SANDBOX COVERAGE, INBOUND HALF (SBX standard 2026-11-15). The mailbox is read by POLL (the connection poll of
 * `imap-inbox-poller.service.ts`; no mail server calls NIVO), so its cases are `pull` cases (the account's next case picks the SET of mails
 * the next poll finds), not webhook cases: the standard's `inbound` role (sender / not-a-line / malformed / shapes) is built for webhook cases
 * and cannot hold them (request to SBX-LEAD in R4-NOTES). What each set proves of those inbound situations, from the live parser and the
 * trigger's translate (`imap-message.policy.ts`, `imap-mail.trigger.ts` `writtenByMachine` / `translateImapMailRow`). SBX-LEAD: the gate's
 * `inbound` role now takes the cases of a `pull` operation as the provider's events, so these are declared below as `inboundRole`:
 * - a stranger's mail (unknown sender) IMAP-5; a person's mail with text IMAP-1..4 and 6; a reply in the thread IMAP-9;
 * - a picture attached IMAP-10, a PDF attached IMAP-11 (name, type, size are kept, the bytes stay at the mailbox);
 * - no line (the headers say no person wrote it): an auto-reply IMAP-8 (`Auto-Submitted`), a bounce IMAP-13 (`Return-Path: <>`);
 * - an unreadable message IMAP-12 (`unreadableRow`: no sender, no text, so no line);
 * - a burst IMAP-7, a busy mailbox of more than one page IMAP-16.
 * The same pull role is declared for both provider keys that answer it: `imap` (the inbound half standing alone) and `smtp` (a mailbox
 * account holding its inbound half, whose send half is in `email-messages/smtp-sandbox.coverage.ts`).
 */
const pullRole: SandboxRoleCoverage = {
    role: "pull",
    operation: "pull",
    covers: {
        "pull.first": { cases: ["IMAP-1"] },
        "pull.new": { cases: ["IMAP-2", "IMAP-3", "IMAP-9"] },
        "pull.changed": {
            na: "a mail never changes at the mailbox: the same UID read again is the same row (kept once by its key `<folder>:<uidvalidity>:<uid>`), so the live pull has no changed mail to bring",
        },
        "pull.page": { cases: ["IMAP-16"] },
        // IMAP-12: a message the parser cannot read becomes an unreadable row while the readable mail of the same page is brought.
        "pull.partial": { cases: ["IMAP-12"] },
    },
}

/** The mailbox's events as the standard's `inbound` role: each shape the translate reads, from the pulled sets above. */
const inboundRole: SandboxRoleCoverage = {
    role: "inbound",
    shapes: {
        "mail with text": ["IMAP-1"],
        "reply in a thread": ["IMAP-9"],
        "picture attached": ["IMAP-10"],
        "pdf attached": ["IMAP-11"],
        "auto-reply": ["IMAP-8"],
        bounce: ["IMAP-13"],
        "unreadable message": ["IMAP-12"],
    },
    covers: {
        "inbound.unknown_sender": { cases: ["IMAP-5"] },
        "inbound.not_a_line": { cases: ["IMAP-8", "IMAP-13"] },
        "inbound.malformed": { cases: ["IMAP-12"] },
        "inbound.withheld": {
            na: "a mailbox never calls NIVO: the trigger is `via: [poll]` only, so every mail is found by the poll and there is no webhook to withhold",
        },
    },
}

/** The `imap` account's coverage: the pull, and the login it needs. */
export const IMAP_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "imap",
    roles: [
        inboundRole,
        pullRole,
        {
            role: "connection",
            covers: {
                "connection.credential_refused": { cases: ["IMAP-14"] },
                "connection.revoked": { cases: ["IMAP-14"] },
                "connection.refresh": { na: "a mailbox login is a password (an app password), not a token: nothing is refreshed, and no other worker refreshes it" },
            },
        },
    ],
}

/** The pull of a mailbox `smtp` account (its inbound half); its `connection` role is declared with the send half. */
export const MAILBOX_SANDBOX_COVERAGE: SandboxCoverage = { provider: "smtp", roles: [inboundRole, pullRole] }
