---
check: cells-author-emit
concept:
  - .starciwork/concepts/project-ext.md
---

# Project check `cells-author-emit`

Program `ext/checks/cells-author-emit.mjs`: no arguments, exit 0 is green. Run by the `checks` step of `starci app check` and by
`npm run ext:check`.

## What it guards

The two cells fixture packages (`be/src/tests/fixtures/cells/demo-money`, `demo-crm-lead`) are byte for byte what the authoring helper
`@nivo-lite/cells-author` emits from their typed projects (`packages/cells-author/test/authoring/<package>.author.ts`): every `cell.yaml`,
`graph.yaml`, `cells.package.yaml`, and every stored `run.js` / `translate.js`, which is the COMPILED text of its `.ts` origin
(CELLS-PLAN 3.4, CELLS-DECISIONS D3). A hand edit of a seed file, or a `.ts` origin changed without re-emitting, is red.

## What it runs

`npm run build -w @nivo-lite/cells-author`, then for each package
`node packages/cells-author/dist/cli.js emit --check --root be/src/tests/fixtures/cells/<package> --entry packages/cells-author/test/authoring/<package>.author.ts`.
Each prints `cells-author emit --check: <n> file(s) differ of <m>` and one line per differing file with the first differing character.

## How to fix a finding

Change the authoring project (or the `.ts` origin), then run the same command without `--check` to write the files, and commit both.
Never edit an emitted file by hand.

## Concept

`.starciwork/concepts/project-ext.md`.
