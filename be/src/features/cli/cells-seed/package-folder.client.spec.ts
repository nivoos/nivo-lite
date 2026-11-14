import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Test } from "@nestjs/testing"
import { FIXTURE_PACKAGES, buildSeed } from "@tests/fixtures/builders/cells-seed.builder"
import { PackageFolderClient } from "./package-folder.client"

describe("PackageFolderClient", () => {
    let folder = ""

    beforeEach(async () => {
        folder = await mkdtemp(join(tmpdir(), "cells-seed-"))
    })

    afterEach(async () => {
        await rm(folder, { recursive: true, force: true })
    })

    it("reads yaml, js and ts files by forward-slash path, and skips other files and the .git and node_modules folders", async () => {
        await mkdir(join(folder, "cells", "tool", "t", "v1"), { recursive: true })
        await mkdir(join(folder, "node_modules", "x"), { recursive: true })
        await mkdir(join(folder, ".git"), { recursive: true })
        await writeFile(join(folder, "cells.package.yaml"), "key: a\n")
        await writeFile(join(folder, "cells", "tool", "t", "v1", "cell.yaml"), "kind: tool\n")
        await writeFile(join(folder, "cells", "tool", "t", "v1", "run.js"), "function run() {}\n")
        await writeFile(join(folder, "cells", "tool", "t", "v1", "run.ts"), "export function run() {}\n")
        await writeFile(join(folder, "README.md"), "x")
        await writeFile(join(folder, "node_modules", "x", "i.js"), "x")
        await writeFile(join(folder, ".git", "c.yaml"), "x")
        const moduleRef = await Test.createTestingModule({ providers: [PackageFolderClient] }).compile()

        const files = await moduleRef.get(PackageFolderClient).read(folder)

        expect([...files.keys()].sort()).toEqual(["cells.package.yaml", "cells/tool/t/v1/cell.yaml", "cells/tool/t/v1/run.js", "cells/tool/t/v1/run.ts"])
        expect(files.get("cells.package.yaml")).toBe("key: a\n")
    })

    it.each(FIXTURE_PACKAGES)("reads the fixture package %s from disk and its check prints READY", async (name) => {
        const moduleRef = await Test.createTestingModule({ providers: [PackageFolderClient] }).compile()
        const files = await moduleRef.get(PackageFolderClient).read(join(__dirname, "..", "..", "..", "tests", "fixtures", "cells", name))
        const { seed } = await buildSeed()

        const view = await seed.check(files)

        expect(view.lines.at(-1)).toBe("READY")
    })
})
