import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * THE OWNER'S DATABASE SANDBOX COVERAGE (SBX standard 2026-11-15): the database is only PULLED (`database-sync.service.ts`: each mapped table
 * read-only, incrementally by its updated-at cursor, at most DATABASE_MAX_ROWS rows a table a pull). Role `pull` (operation `pull`) and
 * `connection` (the login).
 */
export const DATABASE_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "database",
    roles: [
        {
            // SBX-LEAD: the rows a pull brings are the provider's events (the gate reads the `pull` cases as them).
            role: "inbound",
            shapes: { "rows of each mapped table (customers, orders, products)": ["DATABASE-1"], "a changed row": ["DATABASE-3"] },
            covers: {
                "inbound.unknown_sender": {
                    na: "a database row has no sender: its subject is the row's own key in the owner's table, and no person is ever made from a record",
                },
                "inbound.not_a_line": {
                    na: "every row a pull brings is a record change of a mapped table; a row that did not change is not brought (the updated-at cursor)",
                },
                "inbound.malformed": {
                    na: "rows are read through the owner's column map, not a body: a table that cannot be read is the refused table of `pull.partial` (DATABASE-4)",
                },
                "inbound.withheld": { na: "a database never calls NIVO: it is only pulled, so every row is found by the pull and there is no webhook to withhold" },
            },
        },
        {
            role: "pull",
            operation: "pull",
            covers: {
                "pull.first": { cases: ["DATABASE-1"] },
                "pull.new": { cases: ["DATABASE-2"] },
                "pull.changed": { cases: ["DATABASE-3"] },
                // DATABASE-8: 5,205 orders, the live bound of 5,000 a pull, the cursor then brings the rest.
                "pull.page": { cases: ["DATABASE-8"] },
                // DATABASE-4: one table refused while the others are brought (`DatabaseSyncService.sync`: a refused table is a note, a run with no table read throws).
                "pull.partial": { cases: ["DATABASE-4"] },
            },
        },
        {
            role: "connection",
            covers: {
                "connection.credential_refused": { cases: ["DATABASE-6"] },
                // A database user dropped or its grant removed is answered as a refused login (DATABASE-6) or a refused table (DATABASE-5): the engine tells no other revocation.
                "connection.revoked": { cases: ["DATABASE-6", "DATABASE-5"] },
                "connection.refresh": { na: "a database login is a user and password, not a token: nothing is refreshed, and no other worker refreshes it" },
            },
        },
    ],
}
