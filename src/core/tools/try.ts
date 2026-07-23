/**
 * lean_try: non-mutating tactic trials against the focused proof state.
 * Handles freshness (reads the current goal first), suppresses exact repeat
 * failures from the ledger, and records every outcome.
 */

import { formatWarnings, freshnessSummary, requireData } from "../../backend";
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
  // and the ledger keys on the current fingerprint.
  const contextEnvelope = await harness.client.proofContext(
    {
      file: focus.file,
      declaration: focus.declaration,
      proofPosition: focus.proofPosition,
    },
    signal,
  );
  const context = requireData(contextEnvelope, "lean_context").data;
  const goalFp = goalFingerprint(context);
  const bytes = await readSource(harness.resolveProjectPath(focus.file));
  const sourceHash = sha256(bytes);
  harness.state.goalFingerprint = goalFp;
  harness.state.sourceHash = sourceHash;

  // Suppress exact repeat failures already in the ledger.
  const rows: LeanTryRow[] = [];
  const toRun: string[] = [];
  const seenInBatch = new Set<string>();
  for (const snippet of params.candidates) {
    const prior = hasFailedBefore(harness.state, goalFp, snippet);
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
    const trialEnvelope = await harness.client.trialProofStep(
      {
        file: focus.file,
        declaration: focus.declaration,
        snippets: toRun,
        proofPosition: focus.proofPosition,
      },
      signal,
    );
    const trial = requireData(trialEnvelope, "lean_trial(proof_step)");
    warnings = trial.warnings;
    freshness = freshnessSummary(trial.trust);
    candidatesTruncated = trial.data.candidates_truncated;

    for (const [index, candidate] of trial.data.candidates.entries()) {
      const snippet = toRun[index] ?? candidate.snippet ?? "";
      const firstError = candidate.diagnostics?.diagnostics.find(
        (d) => d.severity === "error",
      );
      const message = firstError?.message;
      recordAttempt(harness.state, {
        file: focus.file,
        declaration: focus.declaration,
        goalFingerprint: goalFp,
        snippet,
        outcome: candidate.status,
        message,
      });
      rows.push({
        snippet,
        status: candidate.status,
        acceptable: meetsAccept(candidate.status, accept),
        message,
        goalsAfter: candidate.goals_after,
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
