/**
 * Integration test for the recycle-retry and post-closure-diagnostic
 * behaviour added to lean_try and lean_apply.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedLeanHarnessConfig } from "../src/config/types";
import { LeanHarness } from "../src/core/harness";
import { leanTry } from "../src/core/tools/try";
import { setFocus } from "../src/proof-state";
import {
  type FakeBackend,
  ok,
  PROJECT_STATUS,
  PROOF_CONTEXT,
  startFakeBackend,
} from "./fake-backend";

const RECYCLE_WARNING = {
  code: "warning",
  severity: "warning",
  message:
    "the worker was recycled or restarted during this call (rss_post_job) " +
    "(rss 8000000 KiB vs limit 5242880 KiB); any non-positive outcome here " +
    "may be a casualty of the recycle rather than a real result.",
  next_action: "retry; if it persists, verify with `lake build`.",
};

const TRIAL_CLOSED = {
  candidates: [
    {
      id: "candidate_1",
      status: "closed",
      diagnostics: {
        summary: { errors: 0, warnings: 0, info: 0 },
        diagnostics: [],
        truncated: false,
      },
    },
  ],
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

// A "failed" verdict paired with the recycle warning — the false negative
// the backend emits when the worker crossed its RSS budget mid-call.
const TRIAL_RECYCLED = {
  candidates: [
    {
      id: "candidate_1",
      status: "failed",
      diagnostics: {
        summary: { errors: 1, warnings: 0, info: 0 },
        diagnostics: [
          { severity: "error", message: "unknown tactic", position: null },
        ],
        truncated: false,
      },
    },
  ],
  candidate_limit: 16,
  candidates_truncated: false,
  summary: {
    requested_candidates: 1,
    returned_candidates: 1,
    candidate_limit: 16,
    candidates_truncated: false,
    partial: false,
    closed: 0,
    progressed: 0,
    failed: 1,
    timeout: 0,
    budget_exceeded: 0,
    not_attempted: 0,
    unsupported: 0,
    output_truncated: 0,
  },
};

// A closed candidate that still carries a trailing error diagnostic (e.g. a
// redundant `rfl` after a `rw` that already closed the goal). The harness
// must report the close verdict without surfacing the post-closure error.
const TRIAL_CLOSED_WITH_TRAILING_ERROR = {
  candidates: [
    {
      id: "candidate_1",
      status: "closed",
      diagnostics: {
        summary: { errors: 1, warnings: 0, info: 0 },
        diagnostics: [
          {
            severity: "error",
            message: "No goals to be solved",
            position: null,
          },
        ],
        truncated: false,
      },
    },
  ],
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

function envelopeWithWarning<T>(data: T) {
  return { ...ok(data), errors: [RECYCLE_WARNING] };
}

function verifyOk() {
  return ok({
    summary: {
      requested: 1,
      verified: 1,
      failed: 0,
      needs_build: 0,
      unknown_coverage: 0,
      truncated: false,
    },
    results: [],
    coverage: {
      unknown: [],
      deleted_files: [],
      renamed_files: [],
      truncated: false,
    },
  });
}

function makeConfig(url: string): ResolvedLeanHarnessConfig {
  return {
    server: { url, requestTimeoutMs: 5000 },
    apply: { onVerifyFailure: "rollback" },
    tools: { enabled: true },
    exposeRawBackendTools: false,
  };
}

describe("leanTry recycle retry and post-closure diagnostics", () => {
  let backend: FakeBackend;
  let dir: string;
  let trialCall: number;
  let trialMode: "recycle" | "trailing-error";
  const harnesses: LeanHarness[] = [];

  beforeEach(async () => {
    trialCall = 0;
    trialMode = "recycle";
    dir = await mkdtemp(join(tmpdir(), "lean-harness-recycle-"));
    backend = await startFakeBackend({
      handlers: {
        lean_context: () => ok(PROOF_CONTEXT),
        lean_trial: () => {
          trialCall += 1;
          if (trialMode === "trailing-error") {
            return ok(TRIAL_CLOSED_WITH_TRAILING_ERROR);
          }
          // recycle mode: first call recycled (false negative) + taint
          // warning; second call clean close.
          return trialCall === 1
            ? envelopeWithWarning(TRIAL_RECYCLED)
            : ok(TRIAL_CLOSED);
        },
        lean_verify: () => verifyOk(),
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

  it("retries a recycled trial once and returns the clean verdict", async () => {
    const file = join(dir, "Test.lean");
    await writeFile(file, "theorem foo : True := by\n  sorry\n", "utf8");
    const harness = new LeanHarness(makeConfig(backend.url));
    setFocus(harness.state, {
      file: "Test.lean",
      declaration: "Fake.step",
      proofPosition: { kind: "default" },
    });
    harnesses.push(harness);

    const result = await leanTry(harness, { candidates: ["trivial"] });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.status).toBe("closed");
    expect(result.rows[0]?.acceptable).toBe(true);
    // The retry happened: two lean_trial calls were made.
    const trialCalls = backend.calls.filter((c) => c.name === "lean_trial");
    expect(trialCalls).toHaveLength(2);
  });

  it("suppresses post-closure diagnostics on a closed candidate", async () => {
    trialMode = "trailing-error";
    const file = join(dir, "Test.lean");
    await writeFile(file, "theorem foo : True := by\n  sorry\n", "utf8");
    const harness = new LeanHarness(makeConfig(backend.url));
    setFocus(harness.state, {
      file: "Test.lean",
      declaration: "Fake.step",
      proofPosition: { kind: "default" },
    });
    harnesses.push(harness);

    const result = await leanTry(harness, { candidates: ["rw [foo]"] });
    expect(result.rows[0]?.status).toBe("closed");
    // The trailing "No goals to be solved" error must not be reported as the
    // candidate's message: the close verdict is authoritative.
    expect(result.rows[0]?.message).toBeUndefined();
  });
});
