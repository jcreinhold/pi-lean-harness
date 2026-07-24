import { describe, expect, it } from "vitest";
import {
  applySnapshot,
  type BranchEntryLike,
  createEmptyState,
  failuresForGoal,
  hasFailedBefore,
  LEDGER_CAP,
  rebuildStateFromBranch,
  recordAttempt,
  snapshotState,
} from "../src/proof-state/ledger";

const base = { file: "A.lean", declaration: "A.thm", goalFingerprint: "fp1" };

describe("recordAttempt", () => {
  it("routes closed/applied to successes and others to failures", () => {
    const state = createEmptyState();
    recordAttempt(state, { ...base, snippet: "trivial", outcome: "closed" });
    recordAttempt(state, { ...base, snippet: "simp", outcome: "failed" });
    expect(state.successfulSteps).toHaveLength(1);
    expect(state.failedAttempts).toHaveLength(1);
  });

  it("deduplicates failures by goal fingerprint and snippet", () => {
    const state = createEmptyState();
    recordAttempt(state, {
      ...base,
      snippet: "simp",
      outcome: "failed",
      message: "first",
    });
    recordAttempt(state, {
      ...base,
      snippet: "simp",
      outcome: "failed",
      message: "second",
    });
    expect(state.failedAttempts).toHaveLength(1);
    expect(state.failedAttempts[0]?.message).toBe("second");
  });

  it("distinguishes failures by source hash: an edit that leaves the goal\n  text unchanged does not lock out a now-valid retry", () => {
    const state = createEmptyState();
    recordAttempt(state, {
      ...base,
      sourceHash: "src-a",
      snippet: "simp",
      outcome: "failed",
      message: "name unresolved",
    });
    // Same goal and snippet, but the file changed (e.g. an import was added):
    // this is NOT a repeat failure and must not be suppressed.
    recordAttempt(state, {
      ...base,
      sourceHash: "src-b",
      snippet: "simp",
      outcome: "failed",
      message: "different obstacle",
    });
    expect(state.failedAttempts).toHaveLength(2);
    // hasFailedBefore keys on the source hash:
    expect(hasFailedBefore(state, "fp1", "simp", "src-a")).toBeDefined();
    expect(hasFailedBefore(state, "fp1", "simp", "src-b")).toBeDefined();
    expect(hasFailedBefore(state, "fp1", "simp", "src-c")).toBeUndefined();
    // Omitting sourceHash matches only entries that also omitted it:
    expect(hasFailedBefore(state, "fp1", "simp")).toBeUndefined();
  });

  it("caps the ledger", () => {
    const state = createEmptyState();
    for (let i = 0; i < LEDGER_CAP + 10; i++) {
      recordAttempt(state, { ...base, snippet: `tac_${i}`, outcome: "failed" });
    }
    expect(state.failedAttempts).toHaveLength(LEDGER_CAP);
  });
});

describe("hasFailedBefore / failuresForGoal", () => {
  it("finds prior failures for the same goal only", () => {
    const state = createEmptyState();
    recordAttempt(state, { ...base, snippet: "simp", outcome: "failed" });
    expect(hasFailedBefore(state, "fp1", "simp")).toBeDefined();
    expect(hasFailedBefore(state, "other-goal", "simp")).toBeUndefined();
    expect(failuresForGoal(state, "fp1")).toHaveLength(1);
  });
});

describe("rebuildStateFromBranch", () => {
  function toolResultEntry(
    toolName: string,
    sessionState: unknown,
  ): BranchEntryLike {
    return {
      type: "message",
      message: { role: "toolResult", toolName, details: { sessionState } },
    };
  }

  it("folds snapshots in branch order; later snapshots win", () => {
    const first = createEmptyState();
    recordAttempt(first, { ...base, snippet: "simp", outcome: "failed" });
    const second = structuredClone(first);
    recordAttempt(second, { ...base, snippet: "trivial", outcome: "applied" });

    const entries: BranchEntryLike[] = [
      { type: "message", message: { role: "user" } },
      toolResultEntry("lean_try", snapshotState(first)),
      toolResultEntry("lean_apply", snapshotState(second)),
      toolResultEntry("bash", { sessionState: { failedAttempts: [] } }), // ignored: not a lean_ tool
    ];
    const state = rebuildStateFromBranch(entries);
    expect(state.failedAttempts).toHaveLength(1);
    expect(state.successfulSteps).toHaveLength(1);
  });

  it("returns empty state when the branch has no snapshots", () => {
    expect(rebuildStateFromBranch([])).toEqual(createEmptyState());
  });

  it("applySnapshot merges partial snapshots", () => {
    const state = createEmptyState();
    applySnapshot(state, { projectRoot: "/p" });
    expect(state.projectRoot).toBe("/p");
    expect(state.successfulSteps).toEqual([]);
  });
});
