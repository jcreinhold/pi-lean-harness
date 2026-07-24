/**
 * lean_apply: the compound transaction that gives this package its name.
 *
 *   1. Resolve the focused declaration and proof position.
 *   2. Confirm the file and goal have not changed since the last observation.
 *   3. Test the exact candidate through lean_trial.
 *   4. Refuse when it fails or makes no meaningful progress.
 *   5. Apply the exact tested text atomically (inside the caller's file lock).
 *   6. Verify the containing declaration.
 *   7. Roll back when verification fails (or keep, per config).
 *   8. Update the proof ledger.
 */

import { formatWarnings, requireData, withRecycleRetry } from "../../backend";
import type {
  LeanDiagnostic,
  ProofBoundary,
  ProofPositionSelector,
  VerificationStatus,
} from "../../backend/types";
import {
  commitEdit,
  computeEdit,
  type PreparedEdit,
  readSource,
  rollbackEdit,
} from "../../edits";
import type { ProofFocus } from "../../proof-state";
import {
  goalFingerprint,
  recordAttempt,
  recordVerification,
  resolveFocus,
  setFocus,
  sha256,
} from "../../proof-state";
import type { LeanHarness } from "../harness";

export interface LeanApplyParams {
  /** Exact tactic text to test and apply. */
  candidate: string;
  /**
   * Acceptance bar: "close_current_goal" (default) requires the candidate to
   * close the goal; "make_progress" also accepts a progressed state.
   */
  require?: "close_current_goal" | "make_progress";
  /**
   * Edit mode: "auto" (default) replaces the boundary tactic when it is a
   * `sorry`/`admit` placeholder and inserts otherwise; "insert" always
   * inserts; "replace" always replaces the boundary tactic's source span.
   */
  mode?: "auto" | "insert" | "replace";
  file?: string;
  declaration?: string;
  proofPosition?: ProofPositionSelector;
}

export type LeanApplyResult =
  | {
      applied: true;
      verificationStatus: "verified";
      focus: ProofFocus;
      edit: {
        path: string;
        snippet: string;
        insertedAfterLine: number;
        mode: "insert" | "replace";
        replacedText?: string;
      };
      axioms?: unknown;
      warningsText: string;
    }
  | {
      applied: false;
      reason: "trial_failed" | "verification_failed" | "insufficient_progress";
      trialStatus?: string;
      verificationStatus?: VerificationStatus;
      rolledBack: boolean;
      focus: ProofFocus;
      diagnostics?: LeanDiagnostic[];
      warningsText: string;
      message: string;
    };

/** Identity lock for non-Pi contexts (tests). */
export const noLock: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn();

export class StaleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleStateError";
  }
}

export async function leanApply(
  harness: LeanHarness,
  params: LeanApplyParams,
  options: {
    signal?: AbortSignal;
    /** File-mutation lock; the extension passes withFileMutationQueue. */
    withLock?: <T>(path: string, fn: () => Promise<T>) => Promise<T>;
  } = {},
): Promise<LeanApplyResult> {
  const { signal } = options;
  const withLock =
    options.withLock ?? ((_: string, fn: () => Promise<unknown>) => fn());
  await harness.ensureReady();
  const focus = resolveFocus(harness.state, params);
  setFocus(harness.state, focus);
  const requireClose =
    (params.require ?? "close_current_goal") === "close_current_goal";

  // Step 2: freshness gate on source bytes.
  const path = harness.resolveProjectPath(focus.file);
  const bytes = await readSource(path);
  const currentHash = sha256(bytes);
  if (harness.state.sourceHash && harness.state.sourceHash !== currentHash) {
    throw new StaleStateError(
      `${focus.file} changed on disk since the last lean_state/lean_try. ` +
        "Re-run lean_state to re-observe the proof before applying.",
    );
  }

  // Step 1+2: fresh context; confirm the goal fingerprint still matches.
  const context = (
    await withRecycleRetry(async () =>
      requireData(
        await harness.client.proofContext(
          {
            file: focus.file,
            declaration: focus.declaration,
            proofPosition: focus.proofPosition,
          },
          signal,
        ),
        "lean_context",
      ),
    )
  ).data;
  const goalFp = goalFingerprint(context);
  if (
    harness.state.goalFingerprint &&
    harness.state.goalFingerprint !== goalFp
  ) {
    throw new StaleStateError(
      "The goal at the focused proof position changed since the last observation. " +
        "Re-run lean_state to re-observe before applying.",
    );
  }

  // Step 3: test the exact candidate.
  const trial = await withRecycleRetry(async () =>
    requireData(
      await harness.client.trialProofStep(
        {
          file: focus.file,
          declaration: focus.declaration,
          snippets: [params.candidate],
          proofPosition: focus.proofPosition,
        },
        signal,
      ),
      "lean_trial(proof_step)",
    ),
  );
  const candidate = trial.data.candidates[0];
  const warningsText = formatWarnings(trial.warnings);

  if (!candidate) {
    throw new Error(
      "lean-host-mcp returned no trial result for the candidate.",
    );
  }

  const firstError = candidate.diagnostics?.diagnostics.find(
    (d) => d.severity === "error",
  );
  recordAttempt(harness.state, {
    file: focus.file,
    declaration: focus.declaration,
    goalFingerprint: goalFp,
    sourceHash: currentHash,
    snippet: params.candidate,
    outcome: candidate.status,
    message: firstError?.message,
  });

  // Step 4: refuse failed or non-progressing candidates.
  if (
    candidate.status === "closed"
      ? false
      : requireClose || candidate.status !== "progressed"
  ) {
    return {
      applied: false,
      reason:
        candidate.status === "progressed"
          ? "insufficient_progress"
          : "trial_failed",
      trialStatus: candidate.status,
      rolledBack: false,
      focus,
      diagnostics: candidate.diagnostics?.diagnostics,
      warningsText,
      message:
        candidate.status === "progressed"
          ? 'Candidate made progress but did not close the goal; re-apply with require: "make_progress" if that is intended.'
          : `Candidate failed in trial (${candidate.status}) and was not applied.`,
    };
  }

  // Step 5: apply the exact tested text atomically.
  const boundary = findBoundary(
    context.proof_boundaries ?? [],
    focus.proofPosition,
  );
  if (!boundary) {
    throw new Error(
      "No proof boundary in the current context matches the focused proof position; " +
        "cannot determine where to insert the tactic.",
    );
  }
  const edit = computeEdit(
    path,
    bytes,
    params.candidate,
    boundary,
    chooseMode(params.mode, boundary),
  );

  return withLock(path, async () => {
    // Re-check bytes inside the lock: a sibling edit may have landed.
    const lockedBytes = await readSource(path);
    if (sha256(lockedBytes) !== currentHash) {
      throw new StaleStateError(
        `${focus.file} changed while the edit was being prepared; nothing was applied.`,
      );
    }
    await commitEdit(edit);

    // Step 6: verify the containing declaration. Retry once if the worker
    // was recycled mid-call (warning taint) or the verdict came back as
    // `worker_recycled`, both of which make a non-positive verdict unreliable.
    const verify = await withRecycleRetry(
      async () =>
        requireData(
          await harness.client.verify(
            {
              targets: [
                {
                  kind: "explicit",
                  file: focus.file,
                  declarations: [focus.declaration],
                },
              ],
              allowSorry: false,
              reportAxioms: true,
            },
            signal,
          ),
          "lean_verify",
        ),
      (data) =>
        data.results.some((r) => r.verification_status === "worker_recycled"),
    );
    const row = verify.data.results.find(
      (r) => r.declaration === focus.declaration,
    );
    const status: VerificationStatus = row?.verification_status ?? "not_found";

    recordVerification(harness.state, {
      file: focus.file,
      declaration: focus.declaration,
      status,
      timestamp: new Date().toISOString(),
    });

    if (status === "verified") {
      recordAttempt(harness.state, {
        file: focus.file,
        declaration: focus.declaration,
        goalFingerprint: goalFp,
        sourceHash: currentHash,
        snippet: params.candidate,
        outcome: "applied",
      });
      harness.state.sourceHash = sha256(edit.newContent);
      return {
        applied: true as const,
        verificationStatus: "verified" as const,
        focus,
        edit: {
          path,
          snippet: params.candidate,
          insertedAfterLine: edit.boundary.source.end_line,
          mode: edit.mode,
          replacedText:
            edit.mode === "replace" ? edit.boundary.excerpt.value : undefined,
        },
        axioms: row?.facts?.axioms,
        warningsText: warningsText + formatWarnings(verify.warnings),
      };
    }

    // Step 7: verification failed — roll back or keep per config.
    const policy = harness.getConfig().apply.onVerifyFailure;
    const diagnostics = row?.diagnostics?.diagnostics;
    if (policy === "rollback") {
      await rollbackEdit(edit);
      recordAttempt(harness.state, {
        file: focus.file,
        declaration: focus.declaration,
        goalFingerprint: goalFp,
        sourceHash: currentHash,
        snippet: params.candidate,
        outcome: "rolled_back",
        message: `verification: ${status}`,
      });
    } else {
      recordAttempt(harness.state, {
        file: focus.file,
        declaration: focus.declaration,
        goalFingerprint: goalFp,
        sourceHash: currentHash,
        snippet: params.candidate,
        outcome: "kept_unverified",
        message: `verification: ${status}`,
      });
      harness.state.sourceHash = sha256(edit.newContent);
    }

    return {
      applied: false as const,
      reason: "verification_failed" as const,
      verificationStatus: status,
      rolledBack: policy === "rollback",
      focus,
      diagnostics,
      warningsText: warningsText + formatWarnings(verify.warnings),
      message:
        policy === "rollback"
          ? `Edit applied but verification returned "${status}"; the file was restored to its original bytes.`
          : `Edit applied but verification returned "${status}"; the unverified edit was kept (apply.onVerifyFailure = "keep").`,
    };
  }) as Promise<LeanApplyResult>;
}

function findBoundary(
  boundaries: ProofBoundary[],
  position: ProofPositionSelector,
): ProofBoundary | undefined {
  switch (position.kind) {
    case "default":
      return boundaries.find((b) => b.selector.kind === "default");
    case "index":
      return boundaries.find(
        (b) =>
          b.selector.kind === "index" && b.selector.index === position.index,
      );
    case "after_text":
      // after_text positions resolve to a concrete boundary; match by excerpt.
      return boundaries.find(
        (b) => b.excerpt.value.trim() === position.text.trim(),
      );
  }
}

/** Tactics that are placeholders: always replaced, never inserted before. */
const PLACEHOLDER_TACTICS = new Set(["sorry", "admit"]);

function chooseMode(
  requested: LeanApplyParams["mode"],
  boundary: ProofBoundary,
): "insert" | "replace" {
  if (requested === "insert" || requested === "replace") return requested;
  // auto: a placeholder tactic at the boundary is a scaffold to fill, so
  // replace it; anything else gets the snippet inserted alongside it.
  return PLACEHOLDER_TACTICS.has(boundary.excerpt.value.trim())
    ? "replace"
    : "insert";
}

export type { PreparedEdit };
