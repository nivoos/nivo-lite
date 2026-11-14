# Cells fixtures

Two fixture packages prove every part of the cells kernel on TWO kinds of workflow (CELLS-PLAN 9.3). Slice S2 writes them, one folder
each, as package repositories in the layout of CELLS-PLAN 3.2 (`cells.package.yaml`, `cells/<kind>/<key>/v<version>/cell.yaml` with
`run.js` or `translate.js`, `graphs/<key>/v<version>/graph.yaml`). This file only names them, so the five slices can refer to them
before they exist.

## `demo-money` (kind 1: an outside write that is not repeatable, settled by a read)

| Cell | Kind | What it is for |
|---|---|---|
| `nivo.tool.payment.request.create` | tool | outside write, not repeatable, with `confirmBy` (its read below) |
| `nivo.tool.payment.request.read` | tool | the read that `confirmBy` names |
| `nivo.tool.customer.message.send` | tool | outside write the node calls after the request |
| `demo.ask-to-pay` | node | stored source `run.js`; asks the customer to pay; declares the two tools above |
| `demo.bank-credit` | trigger | pure `translate.js`; turns a raw bank credit into a fact |
| graph `demo.payment` | graph | trigger, a `core.if` match on the paid amount, the node |

## `demo-crm-lead` (kind 2: a subject that is not a person; a repeatable outside write with a replay key)

| Cell | Kind | What it is for |
|---|---|---|
| `nivo.api.crm.demo.post.leads` | operation | declarative HTTP operation with a replay-key header |
| `nivo.tool.crm.lead.create` | tool | repeatable outside write served by the operation above |
| `nivo.tool.record.update` | tool | inside write (the database), refusal is not final |
| `demo.model.complete` | tool | metered tool on a platform-owned account |
| `demo.file-lead` | node | stored source `run.js`; files one lead; declares the tools above |
| graph `demo.lead-intake` | graph | a `core.loop` over leads, the node inside |

The key names are the slice 0 agreement; slice S2 may add cells, never rename these. S4 and S5 read the verdict table and the 11 test-kit
cases against these rows once S2 lands; until then they build their own rows with `ScriptedCell*` and `MemoryCell*` doubles of
`be/src/tests/fixtures/builders/cells.builder.ts`.
