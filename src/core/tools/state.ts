/**
 * lean_state: one normalized view of the current formal situation — proof
 * context, file diagnostics, source/goal freshness, and relevant ledger
 * history — in a single call.
 */

import {
  formatWarnings,
  freshnessSummary,
  requireData,
  withRecycleRetry,
} from "../../backend";
import type {
  DiagnosticsBlock,
  ProofContextData,
  ProofPositionSelector,
  SemanticIssue,
} from "../../backend/types";
import { readSource } from "../../edits";
import type { ProofAttempt, ProofFocus } from "../../proof-state";
import {
  failuresForGoal,
  goalFingerprint,
  resolveFocus,
  setFocus,
  sha256,
} from "../../proof-state";
import type { LeanHarness } from "../harness";

export interface LeanStateParams {
  file?: string;
  declaration?: string;
  proofPosition?: ProofPositionSelector;
  /** Sections to include. Default: all. */
  include?: Array<"goals" | "diagnostics" | "ledger">;
}

export interface LeanStateResult {
  focus: ProofFocus;
  context: ProofContextData;
  fileDiagnostics?: DiagnosticsBlock;
  sourceHash: string;
  goalFingerprint: string;
  freshness: string;
  warnings: SemanticIssue[];
  previousFailures: ProofAttempt[];
  projectRoot?: string;
  toolchain?: string;
  warningsText: string;
}

export async function leanState(
  harness: LeanHarness,
  params: LeanStateParams,
  signal?: AbortSignal,
): Promise<LeanStateResult> {
  const caps = await harness.ensureReady();
  const focus = resolveFocus(harness.state, params);
  setFocus(harness.state, focus);

  const include = new Set(params.include ?? ["goals", "diagnostics", "ledger"]);

  const {
    data: context,
    warnings,
    trust,
  } = await withRecycleRetry(async () =>
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
  );

  const bytes = await readSource(harness.resolveProjectPath(focus.file));
  const sourceHash = sha256(bytes);
  const goalFp = goalFingerprint(context);
  harness.state.sourceHash = sourceHash;
  harness.state.goalFingerprint = goalFp;

  let fileDiagnostics: DiagnosticsBlock | undefined;
  if (include.has("diagnostics")) {
    try {
      const diagEnvelope = await harness.client.fileDiagnostics(
        focus.file,
        signal,
      );
      const diag = requireData(diagEnvelope, "lean_status(file_diagnostics)");
      const data = diag.data as { diagnostics?: DiagnosticsBlock };
      fileDiagnostics = data.diagnostics;
    } catch {
      // File diagnostics are best-effort; the context call already carries
      // declaration-local diagnostics.
    }
  }

  return {
    focus,
    context,
    fileDiagnostics,
    sourceHash,
    goalFingerprint: goalFp,
    freshness: freshnessSummary(trust),
    warnings,
    previousFailures: include.has("ledger")
      ? failuresForGoal(harness.state, goalFp, sourceHash)
      : [],
    projectRoot: caps.projectRoot,
    toolchain: caps.toolchain,
    warningsText: formatWarnings(warnings),
  };
}
