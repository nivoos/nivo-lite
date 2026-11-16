---
check: seed-standards
concept:
  - .starciwork/concepts/seeds-and-data.md
---

# Project check `seed-standards`

Program `ext/checks/seed-standards.mjs`: no arguments, exit 0 is green. Run by the `checks` step of `starci app check`, and by
`npm run ext:check`.

## What it guards

A seed standard (`<name>-seed-standard`, NIVO's package / workspace standard: one repo = one complete workspace) is judged COMPLETE by this
project, not by the harness (the harness judges the generic data standard only: sealed, pinned, under the cap). Read from the stack's own
declarations (no repository name in the check):

1. the default load lists only seed standards: every document of a `seed-standard apply` entry is a `nivo/seed-standard@1` declaration
   with the completeness marker `ext:seed-standards`; no seed manifest names a `-seed-backup`;
2. at the PINNED commit: `seed.json` is a valid `use: workspace` document of the one seed schema; no generated identity (`id`) in it;
   every `secrets/<env>.enc.yaml` has the sops metadata and every non-empty value is `ENC[...]` (by name, never decrypted);
3. READY, derived from what the installed templates declare (never a list per plugin): the owner is named; each plugin is installed at
   the named package version; each agent names its module's installed primary template and version; every node step that lists accounts
   has a usable account of one of its providers (a live one whose secret members are set, or a sandbox one on the local stack); a front-door
   agent has an entrance account; there is knowledge (a document or a truth); every node setting names a node of the template and an
   account of a provider it lists; every declared secret member exists in the sealed file.

A workspace a person creates in the app has no standard and needs none: only the workspaces the stack brings up are judged.

## What it runs

`npm run build:modules`, then `node scripts/seed-standards.mjs --check`. One repository before it is pinned:
`node scripts/seed-standards.mjs --repo <path> [--commit <rev>]`.

## Concept

[seeds-and-data](../../../.starciwork/concepts/seeds-and-data.md)
