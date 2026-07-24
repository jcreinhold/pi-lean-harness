import { describe, expect, it } from "vitest";
import {
  FocusError,
  type FocusOverride,
  resolveFocus,
} from "../src/proof-state/focus";
import { createEmptyState, setFocus } from "../src/proof-state/ledger";

describe("resolveFocus proofPosition persistence", () => {
  it("does not inherit a stored proofPosition: a later call without an\n  override targets the pristine entry goal, not the previously set index", () => {
    const state = createEmptyState();
    // First call sets the focus at index 2.
    const first = resolveFocus(state, {
      file: "A.lean",
      declaration: "A.thm",
      proofPosition: { kind: "index", index: 2 },
    });
    setFocus(state, first);
    expect(first.proofPosition).toEqual({ kind: "index", index: 2 });

    // A later call that omits proofPosition must NOT reuse index 2.
    const second = resolveFocus(state, {
      file: "A.lean",
      declaration: "A.thm",
    });
    expect(second.proofPosition).toEqual({ kind: "default" });
  });

  it("falls back to the stored file and declaration when omitted", () => {
    const state = createEmptyState();
    setFocus(state, {
      file: "A.lean",
      declaration: "A.thm",
      proofPosition: { kind: "default" },
    });
    const focus = resolveFocus(state, {} as FocusOverride);
    expect(focus.file).toBe("A.lean");
    expect(focus.declaration).toBe("A.thm");
    expect(focus.proofPosition).toEqual({ kind: "default" });
  });

  it("throws when no focus can be resolved", () => {
    const state = createEmptyState();
    expect(() => resolveFocus(state, {} as FocusOverride)).toThrow(FocusError);
  });
});
