/**
 * Normalization of lean-host-mcp semantic envelopes into the shapes the
 * facade tools present to the model.
 *
 * Rules (from the backend contract):
 * - Lean-domain outcomes (failed tactic, ambiguous name, needs_build) are
 *   data; they stay in the result.
 * - Infrastructure failures live in `errors` with severity "error" and often
 *   a retryable flag; the facade turns those into thrown tool errors.
 * - Warnings and next actions are advisory; they are surfaced alongside data.
 */

import { LeanBackendError } from "./mcp-client";
import type {
  ArtifactTrust,
  SemanticEnvelope,
  SemanticIssue,
  SemanticTrust,
} from "./types";

export interface NormalizedCall<T> {
  data: T;
  /** Advisory issues (warnings, next actions) to show the model. */
  warnings: SemanticIssue[];
  trust?: SemanticTrust;
}

function isInfraError(issue: SemanticIssue): boolean {
  return issue.severity === "error";
}

/**
 * Unwrap an envelope: throw on infrastructure errors, otherwise return the
 * data plus advisory warnings. Throws when `data` is missing entirely.
 */
export function requireData<T>(
  envelope: SemanticEnvelope<T>,
  toolName: string,
): NormalizedCall<T> {
  const infraErrors = (envelope.errors ?? []).filter(isInfraError);
  const warnings = (envelope.errors ?? []).filter(
    (issue) => !isInfraError(issue),
  );

  if (infraErrors.length > 0) {
    const retryable = infraErrors.some((issue) => issue.retryable === true);
    const lines = infraErrors.map((issue) => {
      const next = issue.next_action ? ` (next: ${issue.next_action})` : "";
      return `- [${issue.code}] ${issue.message}${next}`;
    });
    throw new LeanBackendError(
      `lean-host-mcp reported an infrastructure error in ${toolName}:\n${lines.join("\n")}`,
      { retryable },
    );
  }

  if (envelope.data === null || envelope.data === undefined) {
    const warningText = warnings.map((w) => `- ${w.message}`).join("\n");
    throw new LeanBackendError(
      `lean-host-mcp tool ${toolName} returned no data.` +
        (warningText ? `\nWarnings:\n${warningText}` : ""),
    );
  }

  return { data: envelope.data, warnings, trust: envelope.trust };
}

/** Short human-readable freshness line from trust artifact rows. */
export function freshnessSummary(trust: SemanticTrust | undefined): string {
  if (!trust) return "unknown";
  const artifacts = trust.artifacts ?? [];
  if (artifacts.length === 0) return "current";
  const bad = artifacts.filter(
    (row) => row.status === "stale_build" || row.status === "missing_build",
  );
  if (bad.length === 0) return "current";
  return `stale: ${bad.map(formatArtifact).join("; ")}`;
}

/** Marker string in the recycle/restart warning the backend emits when a
 * worker was recycled mid-call (see lean-host-mcp `execution_taint_text`).
 * A non-positive verdict produced under this taint is not trustworthy. */
const RECYCLE_MARKER = "worker was recycled or restarted during this call";

/** True for the advisory warning the backend attaches when the worker was
 * recycled or restarted during the call. Such a verdict may be a casualty of
 * the recycle, not a real Lean result. */
export function isRecycleWarning(issue: SemanticIssue): boolean {
  return (
    (issue.code === "warning" || issue.severity === "warning") &&
    issue.message.includes(RECYCLE_MARKER)
  );
}

/** True when the call's advisory warnings include a recycle taint. */
export function hasRecycleWarning(warnings: SemanticIssue[]): boolean {
  return warnings.some(isRecycleWarning);
}

/** Run a backend call and retry it once if the worker was recycled mid-call
 * (recycle taint warning) or the call threw a retryable infrastructure
 * error. A single retry matches the backend's own `next_action` and clears
 * the vast majority of false-negative verdicts that heavy modules produce
 * when the worker crosses its RSS budget. The optional `isRecycledData`
 * predicate covers data-level taint signals such as a verify row status of
 * `worker_recycled` that do not appear in the warnings array. */
export async function withRecycleRetry<T>(
  run: () => Promise<NormalizedCall<T>>,
  isRecycledData: (data: T) => boolean = () => false,
): Promise<NormalizedCall<T>> {
  const first = await runAttempt(run);
  if (hasRecycleWarning(first.warnings) || isRecycledData(first.data)) {
    return runAttempt(run);
  }
  return first;
}

async function runAttempt<T>(
  run: () => Promise<NormalizedCall<T>>,
): Promise<NormalizedCall<T>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof LeanBackendError && err.retryable) {
      return run();
    }
    throw err;
  }
}

export function formatArtifact(row: ArtifactTrust): string {
  const where = row.path ?? row.module ?? row.scope;
  const detail = row.detail ? ` — ${row.detail}` : "";
  return `${row.artifact} (${where}): ${row.status}${detail}`;
}

/** Format advisory warnings as markdown bullets for tool output. */
export function formatWarnings(warnings: SemanticIssue[]): string {
  if (warnings.length === 0) return "";
  const lines = warnings.map((issue) => {
    const next = issue.next_action ? ` Next: ${issue.next_action}` : "";
    return `- ${issue.message}${next}`;
  });
  return `\n\nWarnings:\n${lines.join("\n")}`;
}
