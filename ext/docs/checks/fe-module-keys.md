---
check: fe-module-keys
concept:
  - .starciwork/concepts/layers.md
---

# Project check `fe-module-keys`

Program `ext/checks/fe-module-keys.mjs`: no arguments, builds the packages first (`npm run build:modules`, turbo-cached), exit 0 is green.
Run by the `checks` step of `starci app check` and by `npm run ext:check`. Its decision is the pure function `moduleKeyFindings` of
`ext/support/fe-module-keys-rules.mjs`; its spec is `ext/tests/fe-module-keys.spec.mjs`.

## The law

A host app holds no package's key ([layers](../../../.starciwork/concepts/layers.md) rules 6 and 11). What EXISTS (module, agent and
template keys, their declared words, views and blocks) is read from the installed plugins through the plugin registry; what a
WORKSPACE may see and has (the private plugin of its enterprise, its installations, its agents) is what the api returns for that
workspace. The front end never keeps a second, hand-written list of one plugin's keys beside them, and never drops a row the api
returned.

The check reads the keys from the installation (`installed` of `@nivo-lite/plugin-registry`: every plugin's module keys, every
installed module's key, every template agent's key). It holds no key of its own. Then it reads every file of `fe/apps/web/src` and
`fe/packages/*/src` with the TypeScript compiler API (not specs, `__fixtures__`, `__generated__`, `.d.ts`; the admin and landing
apps have no module concept) and reports a string literal equal to one of the keys where code NAMES a type:

- an operand of `===`, `!==`, `==`, `!=`, or of a fallback `??` / `||`;
- a `case`; an element of an array literal; a literal type (also inside a union); an index (`TABLE["key"]`); a quoted property name;
- an initialiser or default (`const KEY = "key"`, a parameter default, a class property); a branch of a conditional; a returned value;
- an argument of a call, except a message-catalogue lookup (a call of `t`, of `x.t`, or of a name bound to `useTranslations` /
  `getTranslations` / `createTranslator` in the same file).

Not findings: a comment, the text of a message, a JSX attribute, a property value, an import specifier. A word that is both a key and an
ordinary word ("content", "sales") stands in those places as a message key or a field name.

## Why

A list of one package's keys in the app makes the app a place where that package lives: a second plugin, or a private plugin of one
enterprise, is dropped or shown with the wrong face until someone edits the app (the case: a workspace with six agents that listed
"0 agents" because the app kept seven other keys). The direction is fixed: the plugin declares, the api serves the workspace, the app
draws what it is told.

## How to fix a finding

- A per-module fact the screen needs (name, description, mark, category, providers it works through, gates, audience, multi-instance)
  is a field of the catalogue the api serves (`modulesCatalog(workspaceId)`): read it from `useModuleCatalog`. If the api lacks it, ask
  the package (the module template) to declare it and the api to serve it; never write the table in the app.
- A decision "is this key known" becomes "did the api serve it for this workspace"; an unknown key is shown with the api's own words
  and the generic default, never hidden.
- A key every installation has (the platform module) is exported by `@nivo-lite/agent-sdk` and imported from there.
- Never add an allow-list entry; fix the source. A finding that cannot be fixed in the app is listed in the lane notes as a request.

## Output

One line per finding `file:line  "key"  role`, then `fe module keys: <n> finding(s) in <files> files (<keys> keys of the installed
plugins)`. Exit 1 on any finding, and when the installation declares no module.

## Concept

`.starciwork/concepts/layers.md`.
