/**
 * LIVE end-to-end against a running lean-host-mcp server. Skipped by default;
 * run with the server up and LEAN_HARNESS_LIVE=1, and create the scratch file
 * first: printf 'theorem scratch_target : True ∧ True := by\n  constructor\n' \
 *   > /path/to/lake/project/LeanHarnessScratch.lean
 * Exercises the full façade protocol through src/core — the same code the
 * Pi tools call.
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ResolvedLeanHarnessConfig } from "../src/config/types";
import { LeanHarness } from "../src/core/harness";
import { leanApply, StaleStateError } from "../src/core/tools/apply";
import { leanSearch } from "../src/core/tools/search";
import { leanState } from "../src/core/tools/state";
import { leanTry } from "../src/core/tools/try";
import { leanVerify } from "../src/core/tools/verify";

const config: ResolvedLeanHarnessConfig = {
  server: { url: "http://127.0.0.1:8765/mcp", requestTimeoutMs: 120_000 },
  apply: { onVerifyFailure: "rollback" },
  tools: { enabled: true },
  exposeRawBackendTools: false,
};

const FILE = process.env.LEAN_HARNESS_LIVE_FILE ?? "LeanHarnessScratch.lean";
const DECL = "scratch_target";

const log: string[] = [];
function record(section: string, value: unknown): void {
  log.push(
    `\n## ${section}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`,
  );
}

const LIVE = process.env.LEAN_HARNESS_LIVE === "1";

describe.skipIf(!LIVE)(
  "live e2e: scratch proof against a running server",
  () => {
    it("runs state -> try -> apply -> verify through the real server", async () => {
      const harness = new LeanHarness(config);
      try {
        // 1. Focus + observe. Position index 0 = state after `constructor`.
        const state = await leanState(harness, {
          file: FILE,
          declaration: DECL,
          proofPosition: { kind: "index", index: 0 },
        });
        record("lean_state", {
          goals: state.context.goals_before,
          freshness: state.freshness,
          boundaries: (state.context.proof_boundaries ?? []).map((b) => ({
            index: b.index,
            kind: b.kind,
            selector: b.selector,
            line: b.source.start_line,
          })),
        });
        expect(state.context.goals_before?.length).toBeGreaterThan(0);

        // 2. Search for the goal (best-effort; just proves the path works).
        try {
          const search = await leanSearch(harness, { limit: 5 });
          record(
            "lean_search",
            search.candidates
              .slice(0, 5)
              .map((c) => ({ name: c.name, why: c.matchReason })),
          );
        } catch (error) {
          record("lean_search (failed, non-fatal)", String(error));
        }

        // 3. Batch trial.
        const trial = await leanTry(harness, {
          candidates: [
            "· trivial\n  · trivial",
            "exact ⟨trivial, trivial⟩",
            "simp",
          ],
        });
        record(
          "lean_try",
          trial.rows.map((r) => ({
            snippet: r.snippet,
            status: r.status,
            ok: r.acceptable,
          })),
        );
        const closing = trial.rows.find((r) => r.status === "closed");
        expect(closing).toBeDefined();

        // 4. Apply the closing candidate.
        if (!closing) throw new Error("no closing candidate in trial");
        const applied = await leanApply(harness, {
          candidate: closing.snippet,
        });
        record("lean_apply", applied);
        expect(applied.applied).toBe(true);

        // 5. Verify the focused declaration through the gate.
        const verify = await leanVerify(harness, { scope: "focus" });
        record(
          "lean_verify",
          verify.results.map((r) => ({
            decl: r.declaration,
            status: r.verification_status,
          })),
        );
        expect(verify.results[0]?.verification_status).toBe("verified");

        // 6. Stale-state refusal: simulate an external edit, then apply again.
        const abs = harness.resolveProjectPath(FILE);
        appendFileSync(abs, "\n-- external edit\n");
        await expect(
          leanApply(harness, { candidate: "trivial" }),
        ).rejects.toThrow(StaleStateError);
        record(
          "stale-state refusal",
          "lean_apply refused after external edit (correct)",
        );
      } finally {
        writeFileSync("/tmp/live-e2e.log", log.join("\n"));
        await harness.client.close().catch(() => undefined);
      }
    }, 300_000);
  },
);
