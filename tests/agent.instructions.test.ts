import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { INSTRUCTIONS } from "@/lib/agent"

/**
 * The connector registry (lib/connectors/registry.ts) now generates the
 * five connector bullets inside INSTRUCTIONS via connectorPromptLines(),
 * replacing a hardcoded block. This test proves the generated string is
 * byte-identical to the literal INSTRUCTIONS string as it existed BEFORE
 * that refactor (captured from git history into
 * tests/fixtures/instructions-original.txt, before any registry edits were
 * made — see the 5A-1/5A-2 connector-registry refactor).
 *
 * If this test fails, a promptHint in lib/connectors/registry.ts drifted
 * from the original bullet text — fix the promptHint, not this test.
 */
describe("agent INSTRUCTIONS", () => {
  it("is byte-identical to the pre-registry-refactor string", () => {
    const original = fs.readFileSync(
      path.join(__dirname, "fixtures", "instructions-original.txt"),
      "utf8",
    )
    expect(INSTRUCTIONS).toBe(original)
  })
})
