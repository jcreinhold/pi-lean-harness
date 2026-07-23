/**
 * LIVE end-to-end against a running lean-host-mcp server. Skipped by default;
 * run with the server up and LEAN_HARNESS_LIVE=1, and create the scratch file
 * first: printf 'theorem scratch_target : True ∧ True := by\n  constructor\n' \
 *   > /path/to/lake/project/LeanHarnessScratch.lean
 * Exercises the full façade protocol through src/core — the same code the
 * Pi tools call.
 */

import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

    it("replaces a sorry placeholder while another sorry remains in the file", async () => {
      // Regression test for the multi-sorry deadlock report: verification is
      // declaration-scoped, and applying a closing proof at a `sorry`
      // boundary must REPLACE the placeholder (not insert before it), or the
      // declaration still contains `sorry` and always fails verification.
      const MULTI_FILE = FILE.replace(/\.lean$/, "Fill.lean");
      const harness = new LeanHarness(config);
      await harness.ensureReady();
      const abs = harness.resolveProjectPath(MULTI_FILE);
      writeFileSync(
        abs,
        "theorem scratch_filled : True := by\n  sorry\n\ntheorem scratch_other : True := by\n  sorry\n",
      );
      try {
        try {
          const state = await leanState(harness, {
            file: MULTI_FILE,
            declaration: "scratch_filled",
            proofPosition: { kind: "default" },
          });
          record("multi-sorry: state", state.context);

          const trial = await leanTry(harness, { candidates: ["trivial"] });
          expect(trial.rows[0]?.status).toBe("closed");

          const applied = await leanApply(harness, { candidate: "trivial" });
          record("multi-sorry: apply", applied);
          // If verification were module-scoped, the surviving `sorry` in
          // scratch_other would force a rollback here.
          expect(applied.applied).toBe(true);
          if (applied.applied) {
            expect(applied.edit.mode).toBe("replace");
            expect(applied.edit.replacedText).toBe("sorry");
          }

          const content = readFileSync(abs, "utf8");
          record("multi-sorry: file after", content);
          expect(content).toContain("trivial");
          expect(content).not.toMatch(/scratch_filled[\s\S]*?sorry\n\n/);
          // The other declaration's sorry is untouched.
          expect(content).toContain(
            "theorem scratch_other : True := by\n  sorry",
          );

          // Declaration inspection: exact statements, not-found handling.
          const inspected = await leanSearch(harness, {
            names: ["Nat.add_comm", "Lean.Harness.NoSuchLemma"],
          });
          record("declaration inspection", inspected.declarations);
          expect(inspected.declarations?.[0]?.found).toBe(true);
          expect(inspected.declarations?.[0]?.statement).toBeTruthy();
          expect(inspected.declarations?.[1]?.found).toBe(false);
        } finally {
          await harness.client.close().catch(() => undefined);
        }
      } finally {
        rmSync(abs, { force: true });
        writeFileSync("/tmp/live-e2e.log", log.join("\n"));
      }
    }, 300_000);
  },
);
