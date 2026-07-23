import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProofBoundary } from "../src/backend/types";
import { commitEdit, computeEdit, EditError, rollbackEdit } from "../src/edits";

const boundary = (overrides: Partial<ProofBoundary> = {}): ProofBoundary => ({
  index: 0,
  kind: "after_tactic",
  selector: { kind: "index", index: 0 },
  source: { start_line: 2, start_column: 3, end_line: 2, end_column: 10 },
  excerpt: { value: "intro h", truncated: false },
  ...overrides,
});

const SOURCE = "theorem foo : True := by\n  intro h\n  sorry\n";

describe("computeEdit", () => {
  it("inserts after the boundary line for after_tactic boundaries", () => {
    const edit = computeEdit("/p/A.lean", SOURCE, "trivial", boundary());
    expect(edit.newContent).toBe(
      "theorem foo : True := by\n  intro h\n  trivial\n  sorry\n",
    );
  });

  it("inserts before the boundary line for entry boundaries", () => {
    const edit = computeEdit(
      "/p/A.lean",
      SOURCE,
      "trivial",
      boundary({ kind: "entry", selector: { kind: "default" } }),
    );
    expect(edit.newContent).toBe(
      "theorem foo : True := by\n  trivial\n  intro h\n  sorry\n",
    );
  });

  it("indents multi-line snippets to the boundary column", () => {
    const edit = computeEdit(
      "/p/A.lean",
      SOURCE,
      "constructor\n· trivial",
      boundary(),
    );
    expect(edit.newContent).toContain("  constructor\n  · trivial\n");
  });

  it("rejects out-of-range spans", () => {
    expect(() =>
      computeEdit(
        "/p/A.lean",
        SOURCE,
        "trivial",
        boundary({
          source: {
            start_line: 9,
            start_column: 1,
            end_line: 9,
            end_column: 5,
          },
        }),
      ),
    ).toThrow(EditError);
  });
});

describe("commit + rollback", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lean-harness-test-"));
    path = join(dir, "A.lean");
    await writeFile(path, SOURCE, "utf8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rollback restores byte-exact original content", async () => {
    const edit = computeEdit(path, SOURCE, "trivial", boundary());
    await commitEdit(edit);
    expect(await readFile(path, "utf8")).not.toBe(SOURCE);
    await rollbackEdit(edit);
    expect(await readFile(path, "utf8")).toBe(SOURCE);
  });
});
