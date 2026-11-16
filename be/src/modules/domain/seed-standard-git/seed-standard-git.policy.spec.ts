import { Test } from "@nestjs/testing"
import { accountsOf, sealedValuesOf } from "./seed-standard-git.policy"

const SUBJECT = Symbol("seed-standard-git.policy")
const VALUE = "credential-value-must-never-leak"

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { accountsOf, sealedValuesOf } }],
    }).compile()
    return moduleRef.get<typeof import("./seed-standard-git.policy")>(SUBJECT)
}

describe("the accounts of a sealed document", () => {
    it("reads accounts.<key>.<member> as strings and leaves out a member of another type or an account that is no mapping", async () => {
        const subject = await build()

        expect(
            subject.accountsOf({
                accounts: { "zalo-a": { credential: "c", webhookSecret: "", port: 5 }, bad: "text", list: [1] },
            }),
        ).toEqual({
            "zalo-a": { credential: "c", webhookSecret: "" },
        })
    })

    it("is no document of accounts when it has none, or holds them as a list or a scalar", async () => {
        const subject = await build()

        expect(subject.accountsOf(null)).toBeNull()
        expect(subject.accountsOf([VALUE])).toBeNull()
        expect(subject.accountsOf({ other: {} })).toBeNull()
        expect(subject.accountsOf({ accounts: [VALUE] })).toBeNull()
        expect(subject.accountsOf({ accounts: VALUE })).toBeNull()
    })
})

describe("the sealed file as the seed reads it", () => {
    it("reads the opened text as accounts, empty members kept (a member declared and not set)", async () => {
        const subject = await build()

        const values = subject.sealedValuesOf({
            opened: true,
            text: `accounts:\n  zalo-a:\n    credential: ${VALUE}\n    webhookSecret: ""\n  other:\n    credential: x\n`,
        })

        expect(values).toEqual({
            opened: true,
            accounts: { "zalo-a": { credential: VALUE, webhookSecret: "" }, other: { credential: "x" } },
        })
    })

    it("passes the fixed reason a file gave no text with, and names a file that is no mapping, carrying no value", async () => {
        const subject = await build()

        const answers = [
            subject.sealedValuesOf({ opened: false, reason: "identity_missing" }),
            subject.sealedValuesOf({ opened: true, text: `- ${VALUE}\n` }),
            subject.sealedValuesOf({ opened: true, text: `accounts: [unterminated ${VALUE}` }),
        ]

        expect(answers).toEqual([
            { opened: false, reason: "identity_missing" },
            { opened: false, reason: "not_a_mapping" },
            { opened: false, reason: "not_a_mapping" },
        ])
        expect(JSON.stringify(answers)).not.toContain(VALUE)
    })
})
