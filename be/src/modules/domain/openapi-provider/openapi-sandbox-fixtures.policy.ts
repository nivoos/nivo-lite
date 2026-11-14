import { crmProviderKeyOf } from "@nivo-lite/agent-sdk/names"
import type { ProviderSandboxAnswer, ProviderTemplate } from "@nivo-lite/agent-sdk/installation"
import { readDocument, responseSchemaOf, violationOf, type PinnedOperation } from "@modules/domain/openapi-tools"
import type { OpenApiSandboxFixtures, OpenApiSandboxOperationFixture } from "./openapi-sandbox-fixtures.contracts"

/** What reading the fixtures of one provider template came to: the fixtures by the document's operation id, and every misfit. */
export interface SandboxFixturesReading {
    readonly fixtures: OpenApiSandboxFixtures
    /** One line per misfit: `<operation> <answer>: <path>: <keyword>` (a path and a keyword, never the value); empty when every answer fits. */
    readonly problems: ReadonlyArray<string>
}

/** One answer of an operation against the response schema the pinned document declares for its status; the misfit as a line, or null. */
const misfitOf = (operation: PinnedOperation, name: string, answer: ProviderSandboxAnswer): string | null => {
    const schema = responseSchemaOf(operation, answer.status)
    if (schema === undefined) return `${name}: status ${String(answer.status)} is not declared by the document`
    const violation = schema === null ? null : violationOf(schema, answer.body)
    return violation === null ? null : `${name}: ${violation === "" ? "body" : violation}`
}

/**
 * The sandbox fixtures a package's provider template ships (`ProviderTemplate.sandbox`, keyed by the operation's ONE name), read for the
 * engine's OpenAPI sandbox: keyed by the pinned document's own operation id (what a call carries), each answer judged against the
 * response schema the document declares for its status, by the same judge a live answer meets (`violationOf`). An operation the document
 * does not serve, and two names of one operation id, are misfits. The default answer of an operation that `keeps` is NOT judged whole:
 * a call's body is laid over it, so it may leave out what the document requires (its refusal and failure answers are judged).
 */
export const sandboxFixturesOf = (template: ProviderTemplate): SandboxFixturesReading => {
    const connector = crmProviderKeyOf(template.id)
    const declared = Object.entries(template.sandbox ?? {})
    const reading = readDocument(JSON.stringify(template.openapi), connector)
    if (!reading.ok) {
        return { fixtures: { connector, operations: {} }, problems: [`document: ${reading.problem}`] }
    }
    const operations: Record<string, OpenApiSandboxOperationFixture> = {}
    const problems: Array<string> = []
    for (const [name, fixture] of declared) {
        const operation = reading.document.operations.get(name)
        if (operation === undefined) {
            problems.push(`${name}: not an operation of the pinned document`)
            continue
        }
        if (Object.hasOwn(operations, operation.operationId)) {
            problems.push(`${name}: its operation id ${operation.operationId} is already declared by another name`)
            continue
        }
        operations[operation.operationId] = fixture
        const answers: ReadonlyArray<readonly [string, ProviderSandboxAnswer | undefined]> = [
            [`${name} OPENAPI-1`, fixture.keeps === undefined ? fixture : undefined],
            [`${name} OPENAPI-2`, fixture.refused],
            [`${name} OPENAPI-3`, fixture.failed],
        ]
        for (const [label, answer] of answers) {
            const problem = answer === undefined ? null : misfitOf(operation, label, answer)
            if (problem !== null) problems.push(problem)
        }
    }
    return { fixtures: { connector, operations }, problems }
}
