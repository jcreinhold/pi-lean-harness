/**
 * Integration test for lean_apply against the fake MCP backend, covering the
 * success path and both onVerifyFailure policies.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedLeanHarnessConfig } from "../src/config/types";
import { LeanHarness } from "../src/core/harness";
import { leanApply } from "../src/core/tools/apply";
import { setFocus } from "../src/proof-state";
import {
  type FakeBackend,
  ok,
  PROJECT_STATUS,
  PROOF_CONTEXT,
  startFakeBackend,
} from "./fake-backend";

const SOURCE = "theorem foo : True := by\n  sorry\n";

const TRIAL_CLOSED = {
  candidates: [{ id: "candidate_1", status: "closed" }],
  candidate_limit: 16,
  candidates_truncated: false,
  summary: {
    requested_candidates: 1,
    returned_candidates: 1,
    candidate_limit: 16,
    candidates_truncated: false,
    partial: false,
    closed: 1,
    progressed: 0,
    failed: 0,
    timeout: 0,
    budget_exceeded: 0,
    not_attempted: 0,
    unsupported: 0,
    output_truncated: 0,
  },
};

function verifyEnvelope(status: string) {
  return ok({
    summary: {
      requested: 1,
      verified: status === "verified" ? 1 : 0,
      failed: status === "verified" ? 0 : 1,
      needs_build: 0,
      unknown_coverage: 0,
      truncated: false,
    },
    results: [
      {
        id: "group_1:Test.foo",
        file: "Test.lean",
        declaration: "Test.foo",
        verification_status: status,
        facts: {},
        diagnostics: {
          summary: {
            errors: status === "verified" ? 0 : 1,
            warnings: 0,
            info: 0,
          },
          diagnostics:
            status === "verified"
              ? []
              : [
                  {
                    severity: "error",
                    message: "unsolved goals",
                    position: null,
                  },
                ],
          truncated: false,
        },
      },
    ],
    coverage: {
      unknown: [],
      deleted_files: [],
      renamed_files: [],
      truncated: false,
    },
  });
}

function makeConfig(
  url: string,
  onVerifyFailure: "rollback" | "keep",
): ResolvedLeanHarnessConfig {
  return {
    server: { url, requestTimeoutMs: 5000 },
    apply: { onVerifyFailure },
    tools: { enabled: true },
    exposeRawBackendTools: false,
  };
}

describe("leanApply", () => {
  let backend: FakeBackend;
  let dir: string;
  let verifyStatus: string;
  const harnesses: LeanHarness[] = [];

  beforeEach(async () => {
    verifyStatus = "verified";
    dir = await mkdtemp(join(tmpdir(), "lean-harness-apply-"));
    backend = await startFakeBackend({
      handlers: {
        lean_context: () => ok(PROOF_CONTEXT),
        lean_trial: () => ok(TRIAL_CLOSED),
        lean_verify: () => verifyEnvelope(verifyStatus),
        lean_lookup: () => ok({}),
        lean_status: () => ok({ ...PROJECT_STATUS, project_root: dir }),
      },
    });
  });

  afterEach(async () => {
    for (const harness of harnesses.splice(0)) {
      await harness.client.close().catch(() => undefined);
    }
    await backend.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function makeHarness(
    onVerifyFailure: "rollback" | "keep",
  ): Promise<LeanHarness> {
    // Point the fake project root at the temp dir.
    const file = join(dir, "Test.lean");
    await writeFile(file, SOURCE, "utf8");
    const harness = new LeanHarness(makeConfig(backend.url, onVerifyFailure));
    setFocus(harness.state, {
      file: "Test.lean",
      declaration: "Test.foo",
      proofPosition: { kind: "default" },
    });
    harnesses.push(harness);
    return harness;
  }

  it("applies and verifies a closing candidate, replacing the sorry placeholder", async () => {
    const harness = await makeHarness("rollback");
    const result = await leanApply(harness, { candidate: "trivial" });
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.edit.mode).toBe("replace");
      expect(result.edit.replacedText).toBe("sorry");
    }
    const content = await readFile(join(dir, "Test.lean"), "utf8");
    expect(content).toBe("theorem foo : True := by\n  trivial\n");
    expect(harness.state.lastVerification?.status).toBe("verified");
    expect(
      harness.state.successfulSteps.some((a) => a.outcome === "applied"),
    ).toBe(true);
  });

  it('inserts instead of replacing when mode is "insert"', async () => {
    const harness = await makeHarness("rollback");
    const result = await leanApply(harness, {
      candidate: "trivial",
      mode: "insert",
    });
    expect(result.applied).toBe(true);
    if (result.applied) expect(result.edit.mode).toBe("insert");
    const content = await readFile(join(dir, "Test.lean"), "utf8");
    expect(content).toBe("theorem foo : True := by\n  trivial\n  sorry\n");
  });

  it("rolls back when verification fails and policy is rollback", async () => {
    verifyStatus = "has_unresolved_goals";
    const harness = await makeHarness("rollback");
    const result = await leanApply(harness, { candidate: "trivial" });
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("verification_failed");
      expect(result.rolledBack).toBe(true);
    }
    expect(await readFile(join(dir, "Test.lean"), "utf8")).toBe(SOURCE);
    expect(
      harness.state.failedAttempts.some((a) => a.outcome === "rolled_back"),
    ).toBe(true);
  });

  it("keeps the edit when verification fails and policy is keep", async () => {
    verifyStatus = "has_unresolved_goals";
    const harness = await makeHarness("keep");
    const result = await leanApply(harness, { candidate: "trivial" });
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.rolledBack).toBe(false);
    }
    expect(await readFile(join(dir, "Test.lean"), "utf8")).toBe(
      "theorem foo : True := by\n  trivial\n",
    );
    expect(
      harness.state.failedAttempts.some((a) => a.outcome === "kept_unverified"),
    ).toBe(true);
  });

  it("commits a multi-line proof body with skipTrial, verifying and rolling\n  back on failure", async () => {
    verifyStatus = "verified";
    const harness = await makeHarness("rollback");
    const result = await leanApply(harness, {
      candidate: "have h : True := trivial\n  trivial",
      skipTrial: true,
    });
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.edit.mode).toBe("replace");
      expect(result.edit.replacedText).toBe("sorry");
    }
    const content = await readFile(join(dir, "Test.lean"), "utf8");
    expect(content).toBe(
      "theorem foo : True := by\n  have h : True := trivial\n  trivial\n",
    );
    // No lean_trial call was made: skipTrial bypasses the trial re-test.
    const trialCalls = backend.calls.filter((c) => c.name === "lean_trial");
    expect(trialCalls).toHaveLength(0);
  });

  it("rolls back a skipTrial multi-line body when verification fails", async () => {
    verifyStatus = "has_unresolved_goals";
    const harness = await makeHarness("rollback");
    const result = await leanApply(harness, {
      candidate: "have h : True := trivial\n  sorry",
      skipTrial: true,
    });
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("verification_failed");
      expect(result.rolledBack).toBe(true);
    }
    expect(await readFile(join(dir, "Test.lean"), "utf8")).toBe(SOURCE);
    const trialCalls = backend.calls.filter((c) => c.name === "lean_trial");
    expect(trialCalls).toHaveLength(0);
  });

  it("records backend calls through the transaction", async () => {
    const harness = await makeHarness("rollback");
    await leanApply(harness, { candidate: "trivial" });
    const names = backend.calls.map((c) => c.name);
    expect(names).toContain("lean_context");
    expect(names).toContain("lean_trial");
    expect(names).toContain("lean_verify");
  });
});
