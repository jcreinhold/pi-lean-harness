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
