#!/usr/bin/env node
// ext/manifest.json check `cells-author-emit` (doc ext/docs/checks/cells-author-emit.md): the committed seed files of each cells fixture package are
// byte for byte what `cells-author emit` writes from its typed authoring project (CELLS-PLAN 3.4, CELLS-DECISIONS D3: the stored `.js` is the
// compiled text of its `.ts` origin, and the yaml is the builders' output). No argument; exit 0 green, else the first failing step's status.
// It BUILDS FIRST (the check contract has no `needs`): `npm run build -w @nivo-lite/cells-author` (the package has no workspace dependency), dist/ only.
// It never writes a fixture: `emit --check` only compares.
import { resolve } from "node:path"
import { ROOT, buildPackage, exitWith, node } from "../support/program.mjs"

/** The fixture packages and their authoring projects. */
const PACKAGES = ["demo-money", "demo-crm-lead"]

const emitCheck = (name) => () =>
    node(
        "packages/cells-author/dist/cli.js",
        "emit",
        "--check",
        "--root",
        `be/src/tests/fixtures/cells/${name}`,
        "--entry",
        // the entry is read from the package root otherwise: name it from the app root
        resolve(ROOT, `packages/cells-author/test/authoring/${name}.author.ts`),
    )

exitWith(() => buildPackage("@nivo-lite/cells-author"), ...PACKAGES.map(emitCheck))
