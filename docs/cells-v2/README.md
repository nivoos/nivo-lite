# NIVO V2 cells: phase 0 (the kernel)

## Tóm tắt (tiếng Việt)

- **Cells là gì.** Mọi khối dựng của một quy trình V2 (tool, operation, node, trigger, provider, và các bước điều khiển `core.if`,
  `core.loop`, `core.wait`, `core.set`, `core.outcome` ...) là MỘT dòng trong cơ sở dữ liệu (schema `cells`), có phiên bản, có schema
  đầu vào / đầu ra / cấu hình, có "semantics" (có ghi không, ghi ra ngoài NIVO không, gửi lại được không, xác nhận bằng cách đọc nào,
  từ chối nào là cuối cùng, có tính credit không) và, nếu có logic, có MÃ NGUỒN đã biên dịch.
- **Nguyên tắc.** Engine là code; mọi thứ engine chạy là dòng trong DB, kể cả logic. Gói (package) là dữ liệu seed (YAML + `.js` biên dịch
  từ `.ts`) nạp vào DB một lần, có biên nhận; không có `define*`, không có registry import code.
- **Chạy thế nào.** Một executor duy nhất: kiểm đầu vào → cổng credit → ghi ý định (nếu là thao tác ghi) → chạy (mã nguồn trong runner
  cô lập QuickJS/WebAssembly ở tiến trình con; khai báo thì qua cửa tool; điều khiển thì qua bộ thông dịch biểu thức) → kiểm đầu ra →
  phân loại (bảng verdict) → ghi credit. `tool()` trong mã là ĐỒNG BỘ, không async/await.
- **Đã chứng minh.** Hai gói mẫu (demo-money, demo-crm-lead) seed vào Postgres thật (container tạm), đọc lại, chạy qua executor thật
  với runner thật, và bộ test chung `CellProofService` chứng minh từng dòng; 509 test đơn vị xanh (30 tệp spec); cổng `cells-isolation` và
  `cells-author-emit` xanh.
- **Chưa làm.** Runtime LangGraph cho đồ thị V2, trigger thật, cửa tool / ledger / meter thật, providers (pha tiếp theo, SePay trước),
  giao diện dựng. Điều kiện triển khai C1: tiến trình runner phải chặn mạng ở mức hệ điều hành / container trước khi phục vụ ngoài dev.

---

## 1. What cells are

NIVO V2 keeps every building block of a workflow in the DATABASE. Each block is a **cell**: one versioned row with

- an identity `kind:key@version` (kinds: `operation`, `tool`, `node`, `trigger`, `provider`, `core.if`, `core.loop`, `core.wait`,
  `core.hand-back`, `core.call-workflow`, `core.outcome`, `core.set`);
- typed `input`, `output` and `config` (JSON Schema 2020-12);
- **semantics**: the behaviour facts the engine judges it by (`mutates`, `outside`, `repeatable`, `confirmBy`, `refusals`,
  `finalRefusals`, `onceBy`, `tools`, `metered`, `timeoutMs`);
- a kind-specific `body`;
- when it has logic (a node's `run`, a trigger's `translate`), its **source**: the compiled JavaScript text, stored content-addressed
  by sha256;
- its `examples` (input, scripted tool answers, expected outcome), which the test kit runs.

Graphs (workflows) are rows too: a document of steps, each node step naming an EXACT cell version, plus the workflow variables (`vars`).

**The principle: the engine is code; everything it runs is rows in the database, logic included.** A package is seed data, never code
the engine imports. The engine has no `define*` factory and no registry: it reads rows through one reader.

Where it lives: `be/src/modules/domain/cells/` (a NestJS capability), `packages/cell-runner/` (the isolated runner process),
`packages/cells-author/` (the authoring helper), `db/migrations/20261115100*_cells-*.sql`, fixtures in `be/src/tests/fixtures/cells/`.
Nothing of the running engine (V1) imports it (gate B below); the only importers outside its folders are the entity registry line and
the cli composition root (`cells-seed`).

## 2. The tables (schema `cells`)

| Table                 | Rows                                                                                                              | Rules                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `cells.packages`      | one per package VERSION: key, version, visibility `public \| private`, enterprises, author, repository, commit    | UNIQUE (key, version); a version is one row whatever commit it is read from                                             |
| `cells.sources`       | the logic text: language `js-quickjs@1`, text, sha256, bytes, author ref (`<package>@<commit>:<dir>/<origin>.ts`) | UNIQUE (sha256); the text never changes (trigger)                                                                       |
| `cells.definitions`   | every cell of every kind, ONE table                                                                               | UNIQUE (kind, key, version); once `approved` a trigger refuses any change except `approved -> retired` and `deleted_at` |
| `cells.graphs`        | graph versions: document (steps with exact cell versions, `vars`), triggers, document hash                        | UNIQUE (key, version); immutable like definitions                                                                       |
| `cells.seed_receipts` | one per applied package commit (plain or forced) with its report                                                  | UNIQUE (package, commit, forced)                                                                                        |

Nothing is ever hard-deleted: DELETE and TRUNCATE are refused by trigger, and the app role `app_be` has no DELETE grant. A
definition's hash covers its content and its source sha256, never the package, the review state or the review reference, so the same
cell carried by a later package version is `unchanged`.

## 3. The seed package format (the real `demo-money` files)

```
<package>/cells.package.yaml                      key, version (x.y.z), visibility, enterprises (private only), author
<package>/cells/<kind>/<key>/v<n>/cell.yaml       the cell (data)
<package>/cells/<kind>/<key>/v<n>/run.js          the COMPILED source the database stores and the runner runs (trigger: translate.js)
<package>/cells/<kind>/<key>/v<n>/run.ts          the TypeScript origin the author writes; never stored, referenced by the source row
<package>/graphs/<key>/v<n>/graph.yaml            the graph
```

`be/src/tests/fixtures/cells/demo-money/cells/node/demo.ask-to-pay/v1/cell.yaml` (abridged: the second example and `title` cut):

```yaml
kind: node
key: demo.ask-to-pay
version: 1
input:
  type: object
  required: [orderId, total]
  properties: { orderId: { type: string }, total: { type: number } }
output:
  type: object
  required: [payKey]
  properties: { payKey: { type: string } }
semantics:
  mutates: false
  tools: [nivo.tool.payment.request.create, nivo.tool.customer.message.send]
body: { mode: auto, accounts: [sepay, payos] }
source: run.js
origin: run.ts
examples:
  - name: asks 350,000 for DH1001
    input: { orderId: DH1001, total: 350000 }
    tools:
      - { id: nivo.tool.payment.request.create, answer: { ok: true, value: { payKey: DH1001 } } }
      - { id: nivo.tool.customer.message.send, answer: { ok: true, value: { delivered: true } } }
    expect: { ok: { payKey: DH1001 } }
```

`run.ts` (what the author writes, type-checked against `@nivo-lite/cells-author`):

```ts
import type { NodeContext } from "@nivo-lite/cells-author"

interface Input {
  readonly orderId: string
  readonly total: number
}
interface Output {
  readonly payKey: string
}

export function run(input: Input, ctx: NodeContext): Output {
  const asked = ctx.tool("nivo.tool.payment.request.create", { amountVnd: input.total, reference: input.orderId })
  if (!asked.ok) return ctx.cannot("payment request refused: " + asked.refusal)
  ctx.tool("nivo.tool.customer.message.send", { text: ctx.say("ask the customer to pay", asked.value) })
  return { payKey: asked.value.payKey }
}
```

`run.js` (what `cells-author emit` compiles it to, byte-stable; this text is what is hashed, stored and run):

```js
function run(input, ctx) {
  const asked = ctx.tool("nivo.tool.payment.request.create", { amountVnd: input.total, reference: input.orderId })
  if (!asked.ok) return ctx.cannot("payment request refused: " + asked.refusal)
  ctx.tool("nivo.tool.customer.message.send", { text: ctx.say("ask the customer to pay", asked.value) })
  return { payKey: asked.value.payKey }
}
```

The authoring helper (`packages/cells-author`) has typed builders (`graph`, `node`, `ifNode`, `loop`, `wait`, `set`, `outcome`,
`ref`, `when.*`, `cellFile`, `packageFile`, `project`) that EMIT the yaml files, and the compile step (TypeScript `transpileModule`,
ES2022, one script, local helpers bundled, no import / require / eval / host names / async). `cells-author emit --check` fails when the
committed files differ from a fresh emit.

**Seed.** `cli cells-seed check --dir <folder>` judges every cell and graph (no database) and prints `READY` or the refusals with their
typed codes. `cli cells-seed apply --dir <folder> --repository <repo> --commit <sha> [--force] [--dry-run]` writes through the one writer in
one transaction (a savepoint per thing: a bad cell is refused with its code, the rest seeds), then the receipt. A commit already applied is
`skipped`; a new pin of the same files is `unchanged`; `--force` re-applies once per commit; a version the package no longer holds is
reported `no longer in the package: <ref> (kept, never deleted)`; a published version seeded again with other content is refused
`CELLS_VERSION_IMMUTABLE`.

## 4. How a cell runs

`CellExecutorService.execute({ scope, cell, input, config?, facts? })` is the one road for every kind:

1. **Validate in**: input (and config) against the cell's schemas (ajv, 2020-12); else `CELLS_INPUT_INVALID`, nothing runs.
2. **Meter gate**: a `metered` cell in a live world needs credits; an empty pool ends `failed/limits` cause `credits_exhausted`, nothing runs.
3. **Intent** (a write, `mutates`): the ledger records the intent key `<run>:<step>:<sha256 of {cell, input, config}>` BEFORE the act; a
   settled key answers its kept result without acting.
4. **Run**:
   - a cell with a source goes to the **isolated runner**: the api-side `CellRunnerClient` checks the source hash, spawns
     `packages/cell-runner` as a child process (empty environment, Node `--permission` with read access to its own files only,
     `--disallow-code-generation-from-strings`, `windowsHide`), and the child runs the source in **QuickJS compiled to WebAssembly**. The
     guest has no `process`, `require`, `fetch`, `eval`, timers or file system. `Date.now()` / `new Date()` are the recorded `facts.at`,
     `Math.random()` is seeded by `facts.randomSeed`, so a replay repeats the same calls.
   - The guest's only ways out are **`tool(name, args)` and `say(prompt, data)`, which are SYNCHRONOUS**: each suspends the guest
     (Asyncify), goes back to the client, which forwards it to the tool door ONLY if the cell declares the tool (else the run ends
     `CELLS_TOOL_UNDECLARED`), and resumes the guest with the answer `{ ok: true, value } | { ok: false, refusal, facts? }`. A source is
     an ES2022 script with `function run(input, ctx)` (or `function translate(raw)`); async functions and `await` are refused at compile
     time and at seed time (C1). Limits: memory, stack, cpu interrupt, wall clock (paused while a tool call waits), output size, call count.
   - a cell with no source (a tool, an operation) is served by the **tool door** under its own key;
   - a control cell (`core.if`, `core.set`) is evaluated by the **expression interpreter** (no code).
5. **Validate out** against the output schema: an unreadable answer of a write outside NIVO is `unknown`, anything else `failed`.
6. **Classify and book**: the outcome goes through `verdictOf(semantics, outcome)`; usage is booked from the answer envelope (a failed try
   is booked, never billed).

### The verdict table (`cell-verdict.policy.ts`)

| outcome                              | semantics                      | verdict                                       |
| ------------------------------------ | ------------------------------ | --------------------------------------------- |
| ok                                   | any                            | continue                                      |
| ending cannot / declined             | any                            | unsuccessful                                  |
| refused-final                        | any                            | unsuccessful                                  |
| refused                              | write outside NIVO             | stop `act_refused`                            |
| refused                              | a read, or a write inside NIVO | continue                                      |
| transient                            | any                            | retry                                         |
| unknown                              | not a write                    | retry                                         |
| unknown                              | write, `repeatable`            | repeat with the SAME key                      |
| unknown                              | write, `confirmBy`             | confirm with the declared read and its args   |
| unknown                              | write, neither                 | stop `outcome_unknown`, retry after take-over |
| failed confused / permanent / limits | any                            | stop `failed`                                 |
| failed, cause `credits_exhausted`    | any                            | stop `credits_exhausted`                      |

A door answer is classed by typed facts only (`facts.class` = `transient` | `unknown`, then the cell's declared final / declared
refusals, else `CELLS_REFUSAL_UNDECLARED`), never by the words of a message.

### Expressions, `vars`, `core.set`

Conditions are data: `{ op: present | absent | eq | ne | gt | gte | lt | lte | contains (caseFold), ref, value }` with `and / or / not`,
depth at most 4, truth `true | false | unknown` (`unknown` takes `no`); a parity spec proves it equal to V1's `condition-eval` on over
10,000 rows. Refs: `trigger.*`, `steps.<key>.output.*`, `item.*` (inside a loop), `vars.<name>`.
A graph declares its workflow variables (`vars: { paidAmount: { schema: { type: number } } }`); `core.set` writes them
(`config: { set: { paidAmount: { $ref: trigger.data.amountVnd } }, next: match }`) and answers `{ vars: { name: { value, by, at } } }`
(who wrote it last, when). A `core.set` or a `$ref` of an undeclared variable is refused at seed time `CELLS_VAR_UNDECLARED`; parallel
iterations writing a variable that declares no `merge: append` are refused `CELLS_VAR_WRITE_CONFLICT`.

## 5. The test kit

`CellProofService.prove(ref)` proves a cell from its ROW alone (n8n style, "test = generic logic"), each case in a fresh world over the
real executor: `examples`, `valid-input`, `invalid-input`, `output-shape`, `refusal-classes`, `refusal-final`, `refusal-undeclared`,
`transient`, `unknown-outcome`, `intent-once`, `repeatable`, `declared-tools`, `undeclared-tool`, `limits`, `determinism`, `metered`,
`if-truth-table`, `set-update`, `set-undeclared`, `config-checks` (a case the row gives nothing to judge is `na` with its reason). It
catches a node that calls a tool it does not declare, and a `repeatable` cell whose two runs reach the door differently.

## 6. The gates

| Gate                            | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Run                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `cells-isolation` (ext check)   | A: cells imports only its folder, the allowed platform pieces and packages (`typescript` only in the source scan, `ajv8` only in the schema policy, `node:child_process` only in the runner client, `node:crypto` only in the hash policy; specs `node:fs`/`node:path`, and the runner client's spec `node:child_process`/`node:os`). B: nothing outside the cells folders, the fixtures, the doubles, the entity registry line and the cli composition root imports cells. C: no global `eval`, no `Function` constructor, no `vm` in `be/src`, `packages/*/src`, `fe`. D: QuickJS only in `packages/cell-runner/src`; the authoring package imports no be path; the engine imports neither package | `node ext/checks/cells-isolation.mjs`   |
| `cells-author-emit` (ext check) | the fixture packages are byte for byte what `cells-author emit` writes from their typed projects (stored `.js` = compiled `.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `node ext/checks/cells-author-emit.mjs` |
| seed validation                 | every seed-time check with a typed code (schemas through the ONE JSON Schema checker, body, semantics, source scan by AST: import / export / require / dynamic import / eval / Function / async, runner syntax check, entry function, declared tools, examples, graph refs, routes, cycles, expressions, vars)                                                                                                                                                                                                                                                                                                                                                                                       | `cli cells-seed check`                  |
| database triggers               | immutability of published rows and sources, no hard delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | the migrations                          |

## 7. How to run it all on a fresh clone

```bash
npm ci                                   # links the workspace packages, @nivo-lite/cell-runner and @nivo-lite/cells-author included
npm run build -w @nivo-lite/cell-runner  # the specs that run the REAL runner spawn packages/cell-runner/dist/main.js
npm run build -w @nivo-lite/cells-author # the authoring entries import the built package
# (`npm test` builds every workspace package first through `npm run build:modules`, both of these included)

cd be
npx jest --selectProjects unit --runInBand src/modules/domain/cells/   # the kernel specs (one file at a time on a busy host)
npx jest --selectProjects unit --runInBand src/features/cli/cells-seed/ src/tests/fixtures/builders/cells
npx jest --selectProjects unit --runInBand ../packages/cells-author/src/author.spec.ts
cd ..
node --test ext/tests/cells-isolation.spec.mjs
node ext/support/run-checks.mjs cells-isolation cells-author-emit
```

The database proof (section 8, B) ran on a throwaway `postgres:16-alpine` container: the two baseline pieces the migrations need
(role `app_be`, `public.set_updated_at()`, lines 25-32 and 17166-17169 of `db/migrations/20261113180000_baseline.sql`, verbatim), then the
five `20261115100*_cells-*.sql` files with `psql -v ON_ERROR_STOP=1` in order, then a jest spec over that database as role `app_be`.
The spec is kept beside the lane notes (`lanes/cells-20261115/scratch/JOIN/cells-join.pg.spec.ts`), not in the tree: the lane's
integration project needs the full test world.

## 8. What is proven, and how

| Proof                                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Type check                        | `cells` + its fixtures, builders and the `cells-seed` cli: 0 errors; the whole cli app (`be/apps/cli/src`, which pulls most of `be`): 0 errors; `packages/cell-runner`, `packages/cells-author`: 0 errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| B. Throwaway Postgres, both packages | migrations applied; `check` READY; a bad cell refused while the rest seeds (money: `import` in `run.js` -> `CELLS_SOURCE_IMPORTS` + the graph `CELLS_GRAPH_REF_UNKNOWN`, 8 created; crm: finals outside refusals -> 3 refused, 5 created, the shared `core.outcome@1` unchanged); good apply `applied`; reapply `skipped`; new pin `unchanged` (10 and 9 rows); every cell (9 + 8) and graph (1 + 1) read back equal to its files, sources byte-equal; every node / trigger example and every tool / operation through the real executor and the REAL QuickJS runner (12 executions + the graph's `core.if` and `core.set` steps); the test kit over every seeded row read from the database: 17 rows, 0 failures; a changed published version refused by the service (`CELLS_VERSION_IMMUTABLE`) AND by the database trigger, a source text update refused by trigger, a DELETE as `app_be` denied; a removed version reported and still read by its exact ref; a private package listed to `acme` only, never to `beta` or no enterprise; totals 17 definitions, 2 graphs, 3 sources, 3 packages. 16 of 16 green |
| C. Unit specs                        | 30 spec files, 509 tests, every one green, run one file at a time through the lane slot; `cells-isolation` spec 20 of 20                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D. Gates                             | `cells-isolation` 0 findings; `emit --check` 0 differ of 13 / 11; one byte appended to a compiled `run.js` (on a copy) -> red at character 389 / 540; a seeded `.js` with `import`, `export`, `require`, dynamic import, `eval` or `new Function` is refused `CELLS_SOURCE_IMPORTS` (validation spec on demo-money, and on the real database in B), an async entry or any `await` `CELLS_SOURCE_SYNTAX` (validation spec on both fixtures), and `cells-author` refuses async code at compile time with the same rule text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| E. Isolation                         | gate B green; outside the new folders the branch changes only: the entity registry line, the cli composition root (2 files), `cli.module.ts` (1 import), `be/jest.config.js`, the root `package.json` (`ajv8` alias) and `package-lock.json` (the two workspace links)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 9. What is NOT built (next phases)

- The LangGraph runtime that executes V2 graphs (`cells.graphs` rows) as threads; `core.loop`, `core.wait`, `core.hand-back`,
  `core.call-workflow`, `core.outcome` and `provider` are validated and stored but end `control_not_interpreted` if executed.
- Triggers that start V2 runs; the real tool door (rights, `auto | ask`, account choice), the real intent ledger and credit meter (phase 0
  has in-memory ones), any page or GraphQL door, the builder UI.
- Providers on cells (owner D2: next phase, SePay first, no sandbox concept, provider logic as cells over an `http` engine primitive with a
  fake transport for tests).
- The V1 migration steps (export, one classifier, stored logic, providers, thread runtime, packages as seed data).

## 10. Deployment condition (C1)

The isolation rests on the QuickJS-in-WebAssembly boundary and the api-side client. Node's permission model does NOT restrict the network
(probed on Node 24), and on Windows `env: {}` still leaves OS-injected variables (none of ours). Therefore, BEFORE the runner serves anything
but dev and tests, the runner process must run with network egress blocked at the OS / container level (own container or network policy,
read-only file system, cpu / memory cgroup). Accepted weaker points for phase 0: guest stack clamped to 256 KB; an out-of-memory error is
catchable in the guest; the runner's own `check` finds syntax errors only (the seed's AST scan is the gate for `require` / `import()` /
`eval` / async); `Date()` without `new` throws; the entry must be a `function run` / `function translate` declaration.

## 11. Open questions (from the plan)

1. Does "operator generic" mean the provider operation (`nivo.api.*`)? Recommended: yes; expression operators are not cells.
2. Who may author cells? Recommended: NIVO and package authors, through git review; no shop.
3. Should `tool()` be a graph step (`core.call-tool`)? It changes engine-core rule 4. Recommended: yes.
4. Should workspaces ever see cells? Recommended: only as the read-only explanation on the graph page.
5. Fold `defineEffect` into the tool kind? Recommended: yes (done in the V2 model).
6. At the providers step: the decided `providers` table as the FK target beside `cells.definitions`, or provider rows only?
7. V1 package jobs: become nodes / graphs in V2? Recommended: yes.
8. Do users choose the model per node (a node setting + an allowed-models list per plan)?
9. Should the customer-message allowance stay beside the credit pool, or does only the credit pool limit AI work?
