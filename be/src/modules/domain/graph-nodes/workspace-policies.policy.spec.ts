import { Test } from "@nestjs/testing"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { WORKSPACE_POLICIES_MAX_CHARS, workspacePoliciesTextOf } from "./workspace-policies.policy"

/** One policy line as `nivo.tool.brain.policy.list` answers it. */
const lineOf = (id: string, value: string) => ({ id, group: "G", title: `Policy ${id}`, value, unit: null, until: null })

/** An answer of the tool. */
const answerOf = (policies: ReadonlyArray<ReturnType<typeof lineOf>>, total = policies.length) => ({ notice: "N", total, policies })

const SUBJECT = Symbol("workspace-policies.policy")

const build = async (): Promise<{ readonly workspacePoliciesTextOf: typeof workspacePoliciesTextOf }> => {
    const moduleRef = await Test.createTestingModule({ providers: [{ provide: SUBJECT, useValue: { workspacePoliciesTextOf } }] }).compile()
    return moduleRef.get(SUBJECT)
}

describe("workspace-policies.policy: L2 = the answer of nivo.tool.brain.policy.list, rendered the same way every time", () => {
    it("names the tool and writes its answer as key-sorted JSON: the same answer always gives the same bytes", async () => {
        const policy = await build()
        const text = policy.workspacePoliciesTextOf(answerOf([lineOf("a", "1"), lineOf("b", "2")]))
        const reordered = policy.workspacePoliciesTextOf({ total: 2, policies: [{ ...lineOf("a", "1") }, lineOf("b", "2")], notice: "N" })

        expect(text.startsWith(`${TOOL.brainPolicyList}\n`)).toBe(true)
        expect(reordered).toBe(text)
        expect(text).toContain('"notListed":0')
    })

    it("changes when a policy changes and only there", async () => {
        const policy = await build()
        const before = policy.workspacePoliciesTextOf(answerOf([lineOf("a", "1"), lineOf("b", "2")]))
        const after = policy.workspacePoliciesTextOf(answerOf([lineOf("a", "1"), lineOf("b", "5")]))

        expect(after).not.toBe(before)
        expect(after.replace('"value":"5"', '"value":"2"')).toBe(before)
    })

    it("is no layer when the workspace has no policy or the read was refused", async () => {
        const policy = await build()
        expect(policy.workspacePoliciesTextOf(answerOf([]))).toBe("")
        expect(policy.workspacePoliciesTextOf({ ok: false, refusal: "not_found", facts: {} })).toBe("")
    })

    it("holds at most its fixed bound and counts every policy it does not list, the tool's own total included", async () => {
        const policy = await build()
        const many = Array.from({ length: 200 }, (_, at) => lineOf(String(at).padStart(4, "0"), "x".repeat(80)))
        const text = policy.workspacePoliciesTextOf(answerOf(many, 260))
        const listed = (text.match(/"id":"/gu) ?? []).length

        expect(text.length).toBeLessThan(WORKSPACE_POLICIES_MAX_CHARS + 200)
        expect(listed).toBeLessThan(200)
        expect(text).toContain(`"notListed":${260 - listed}`)
        expect(text).toContain('"id":"0000"')
    })
})
