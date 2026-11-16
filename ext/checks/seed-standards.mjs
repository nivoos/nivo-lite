#!/usr/bin/env node
// ext/manifest.json check `seed-standards` (doc ext/docs/checks/seed-standards.md): every seed standard the stack brings up is a COMPLETE
// workspace at its pinned commit (.starciwork/concepts/seeds-and-data.md). No arguments; exit 0 green, else the failing step's status.
// It BUILDS FIRST: `node scripts/seed-standards.mjs --check` reads the built SDK and the installed plugins (as the seed-graphs check).
import { buildModules, exitWith, node } from "../support/program.mjs"

exitWith(buildModules, () => node("scripts/seed-standards.mjs", "--check"))
