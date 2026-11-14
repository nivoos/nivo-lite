---
check: cells-isolation
concept:
  - .starciwork/concepts/layers.md
  - .starciwork/concepts/project-ext.md
---

# Project check `cells-isolation`

Program `ext/checks/cells-isolation.mjs`: no argument for the harness, no build, exit 0 is green (`--root <dir>` points it at another tree
by walking its files; its own spec uses that). Run by the `checks` step of `starci app check` and by `npm run ext:check`. Its decision is
the pure function `cellsIsolationFindings` of `ext/support/cells-isolation-rules.mjs`; its spec is `ext/tests/cells-isolation.spec.mjs`.
Source: CELLS-PLAN 7.2. Imports and calls are read with the TypeScript compiler API: a comment or a string that only mentions a module
is no import. Every form counts: `import`, `import type`, `export ... from`, `import x = require()`, `import()`, `require()`, `jest.mock()`.

## The law (four gates)

- **A, what cells imports.** `be/src/modules/domain/cells/**` imports only its own folder (the alias `@modules/domain/cells` included),
  `@modules/platform/{database,clock,errors,logging,primitives,config}`, `@nestjs/*`, `typeorm`, `ajv`, `yaml`, `@starci/common`. No other
  `@modules/*`, no `@nivo-lite/agent-sdk*`, no plugin package, no relative path out of the folder, and no `node:` module except
  `node:child_process` in `cell-runner.client.ts` and `node:crypto` in `cell-hash.policy.ts`. Three additions the slice-0 skeleton
  needs and that are platform pieces, not capabilities: `@modules/platform/composition` (the injector helper, BE-INJECTION-2),
  `@modules/platform/i18n` (message text) and `@starci/nest-kit` (the module definition). A `*.spec.ts` of cells also reaches the test
  kit `@starci/jest-preset`, `@tests/**` (doubles, builders, fixtures) and `@nivo-lite/agent-sdk/template` (the expression parity spec only).
  Allowances ruled by the coordinator, each named and single-file: `typescript` (used as a PARSER) only in
  `cell-source-scan.policy.ts` (CELLS-DECISIONS D3: the stored `.js` is scanned by AST); `ajv8` (the npm alias of ajv 8, JSON Schema 2020-12)
  only in `cell-json-schema.policy.ts`; `@modules/platform/composition` as above. In `*.spec.ts` files of cells `node:fs`, `node:path` are also
  allowed (specs load the fixture packages from disk); production files keep the strict list, and the spec of this check plants the same
  imports in another production file to show they are refused.
  A type-only import (`import type`) of a `node:` module is erased and allowed. The authoring `.ts` origins under `be/src/tests/fixtures/cells/` import types of
  `@nivo-lite/cells-author` (they are package-author files beside the seed files, never engine code) and are outside the engine part of gate D.
- **B, who imports cells.** No file of `be/**`, `fe/**` or `packages/**` outside `be/src/modules/domain/cells/`, `be/src/features/cli/cells-seed/`,
  `be/src/tests/fixtures/cells/`, the entity registry `be/src/modules/platform/database/entities.ts` and the kit doubles
  (`be/src/tests/fixtures/builders/cells*.builder.ts` and specs) imports `@modules/domain/cells`, by alias, subpath or relative path. The
  runner package reads its protocol types type-only (gate D). The list of later importers lives in the cells concept (empty in phase 0;
  each migration step adds its row), never in this check.
- **C, no code evaluation in the repository.** In `be/src/**`, `packages/*/src/**`, `fe/**`: no call of the GLOBAL `eval` (also
  `globalThis.eval`), no `Function` constructor (`new Function(...)`, `Function(...)`), no import of `vm`, `node:vm`, `vm2`, `isolated-vm`.
  A member call `client.eval(...)` is not the global one: the hits in `connection-poll`, `platform/realtime` and `integrations/redis` are Lua
  on Redis.
- **D, the runner is the only evaluator.** The calls `evalCode` / `evalCodeAsync` and any import of `quickjs-emscripten` occur only under
  `packages/cell-runner/src/**`. Non-spec files there import nothing but `quickjs-emscripten`, their own folder and type-only cells protocol
  types (a runner spec may spawn the child and read its files). `packages/cells-author/**` imports no `be` path (`@modules/*`, `@features/*`,
  `@tests/*`, `be/`, or a relative path into `be/`). `be/**` and `fe/**` import neither `@nivo-lite/cells-author` nor
  `@nivo-lite/cell-runner` (the client spawns the runner process; it never imports its internals).

## Why

The cells kernel runs stored logic in an isolated process. That holds only if the engine never gains a way to evaluate code, the runner
never reaches the engine's modules, and nothing running depends on a capability that is not merged on purpose.

## How to fix a finding

Move the import behind a port of cells (A), have the later migration step add its row to the cells concept and register the importer
(B), remove the evaluation or run it in the runner (C, D). Never add an allow-list entry.

## Output

One line per finding `file:line  <gate> <what>`, then `cells isolation: <n> finding(s) in <files> files (A <n>, B <n>, C <n>, D <n>)`.
Exit 1 on any finding.

## Concept

`.starciwork/concepts/layers.md`, `.starciwork/concepts/project-ext.md`.
