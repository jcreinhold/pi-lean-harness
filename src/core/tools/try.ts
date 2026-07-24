/**
 * lean_try: non-mutating tactic trials against the focused proof state.
 * Handles freshness (reads the current goal first), suppresses exact repeat
 * failures from the ledger, and records every outcome.
 */

import {
  formatWarnings,
  freshnessSummary,
  requireData,
  withRecycleRetry,
} from "../../backend";
import type {
  ProofPositionSelector,
  SemanticIssue,
  TrialCandidateStatus,
} from "../../backend/types";
import { readSource } from "../../edits";
import type { ProofFocus } from "../../proof-state";
import {
  goalFingerprint,
  hasFailedBefore,
  recordAttempt,
  resolveFocus,
  setFocus,
  sha256,
} from "../../proof-state";
import type { LeanHarness } from "../harness";

export type AcceptCriterion = "close" | "progress" | "any";

export interface LeanTryParams {
  candidates: string[];
  /** What counts as acceptable: "close" (default), "progress", or "any". */
  accept?: AcceptCriterion;
  file?: string;
  declaration?: string;
  proofPosition?: ProofPositionSelector;
}

export interface LeanTryRow {
  snippet: string;
  status: TrialCandidateStatus | "skipped_repeat_failure";
  /** True when this candidate satisfies the accept criterion. */
  acceptable: boolean;
  /** First diagnostic message for failed candidates. */
  message?: string;
  goalsAfter?: string[];
  /** When the same snippet failed before on this goal: the earlier message. */
  previousFailure?: string;
}

export interface LeanTryResult {
  focus: ProofFocus;
  rows: LeanTryRow[];
  goalFingerprint: string;
  sourceHash: string;
  freshness: string;
  warnings: SemanticIssue[];
  warningsText: string;
  candidatesTruncated: boolean;
}

function meetsAccept(
  status: TrialCandidateStatus,
  accept: AcceptCriterion,
): boolean {
  if (status === "closed") return true;
  if (status === "progressed") return accept !== "close";
  return accept === "any";
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof (value as { value?: unknown }).value === "string") {
    return (value as { value: string }).value;
  }
  return undefined;
}

export async function leanTry(
  harness: LeanHarness,
  params: LeanTryParams,
  signal?: AbortSignal,
): Promise<LeanTryResult> {
  await harness.ensureReady();
  const focus = resolveFocus(harness.state, params);
  setFocus(harness.state, focus);
  const accept = params.accept ?? "close";

  // Freshness: read the current context so trials run against the live goal
  // and the ledger keys on the current fingerprint. Retry once if the
  // worker was recycled mid-call (heavy modules can cross the RSS budget
  // during elaboration and return a tainted context).
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
  const bytes = await readSource(harness.resolveProjectPath(focus.file));
  const sourceHash = sha256(bytes);
  harness.state.goalFingerprint = goalFp;
  harness.state.sourceHash = sourceHash;

  // Suppress exact repeat failures already in the ledger. Key on the source
  // hash too: an edit that leaves the goal text unchanged (e.g. adding an
  // import to resolve a name) must not lock out a now-valid retry.
  const rows: LeanTryRow[] = [];
  const toRun: string[] = [];
  const seenInBatch = new Set<string>();
  for (const snippet of params.candidates) {
    const prior = hasFailedBefore(harness.state, goalFp, snippet, sourceHash);
    if (prior || seenInBatch.has(snippet)) {
      rows.push({
        snippet,
        status: "skipped_repeat_failure",
        acceptable: false,
        previousFailure:
          prior?.message ?? "duplicate of an earlier candidate in this batch",
      });
      continue;
    }
    seenInBatch.add(snippet);
    toRun.push(snippet);
  }

  let freshness = "unknown";
  let warnings: SemanticIssue[] = [];
  let candidatesTruncated = false;

  if (toRun.length > 0) {
    const trial = await withRecycleRetry(async () =>
      requireData(
        await harness.client.trialProofStep(
          {
            file: focus.file,
            declaration: focus.declaration,
            snippets: toRun,
            proofPosition: focus.proofPosition,
          },
          signal,
        ),
        "lean_trial(proof_step)",
      ),
    );
    warnings = trial.warnings;
    freshness = freshnessSummary(trial.trust);
    candidatesTruncated = trial.data.candidates_truncated;

    for (const [index, candidate] of trial.data.candidates.entries()) {
      const snippet = toRun[index] ?? textValue(candidate.snippet) ?? "";
      const allDiagnostics = [
        ...(candidate.diagnostics?.diagnostics ?? []),
        ...(candidate.downstream_diagnostics?.diagnostics ?? []),
      ];
      // A closed goal is authoritative; any trailing diagnostics are
      // post-closure noise (e.g. a redundant `rfl` after a `rw` that already
      // closed it) and must not be reported as the candidate's message.
      const firstError =
        candidate.status === "closed"
          ? undefined
          : allDiagnostics.find((d) => d.severity === "error");
      const message = firstError?.message;
      recordAttempt(harness.state, {
        file: focus.file,
        declaration: focus.declaration,
        goalFingerprint: goalFp,
        sourceHash,
        snippet,
        outcome: candidate.status,
        message,
      });
      const remainingGoals = (candidate.goals_after ?? candidate.goals)
        ?.map(textValue)
        .filter((g): g is string => typeof g === "string");
      rows.push({
        snippet,
        status: candidate.status,
        acceptable: meetsAccept(candidate.status, accept),
        message,
        goalsAfter: remainingGoals,
      });
    }
  }

  return {
    focus,
    rows,
    goalFingerprint: goalFp,
    sourceHash,
    freshness,
    warnings,
    warningsText: formatWarnings(warnings),
    candidatesTruncated,
  };
}
