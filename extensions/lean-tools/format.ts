/**
 * Text formatting for tool results: the `content` text is what the model
 * reads, so keep it structured, compact, and consistent across tools.
 */

import type {
  LeanApplyResult,
  LeanSearchResult,
  LeanStateResult,
  LeanTryResult,
  LeanVerifyResult,
} from "../../src/core";
import type { LeanSessionState, ProofFocus } from "../../src/proof-state";

export function formatFocusLine(focus: ProofFocus): string {
  return `Declaration: ${focus.declaration}\nFile: ${focus.file}\nProof position: ${JSON.stringify(focus.proofPosition)}`;
}

export function formatState(result: LeanStateResult): string {
  const parts: string[] = [formatFocusLine(result.focus)];
  if (result.toolchain) parts.push(`Toolchain: ${result.toolchain}`);
  parts.push(`Source freshness: ${result.freshness}`);

  const goals = result.context.goals_before ?? [];
  parts.push("\nGoals:");
  parts.push(
    goals.length > 0
      ? goals.map((g, i) => `${i + 1}. ${g}`).join("\n")
      : "(none)",
  );

  const diagnostics = result.context.diagnostics;
  if (diagnostics && diagnostics.diagnostics.length > 0) {
    parts.push("\nDiagnostics:");
    parts.push(
      diagnostics.diagnostics
        .slice(0, 10)
        .map((d) => `- [${d.severity}] ${d.message}`)
        .join("\n"),
    );
  } else {
    parts.push("\nDiagnostics: none");
  }

  const needsBuild = result.context.needs_build ?? [];
  if (needsBuild.length > 0) {
    parts.push("\nBlocked (needs build):");
    parts.push(needsBuild.map((b) => `- ${b.message}`).join("\n"));
  }

  if (result.previousFailures.length > 0) {
    parts.push("\nPrevious failures on this state:");
    parts.push(
      result.previousFailures
        .slice(-8)
        .map(
          (a) =>
            `- ${a.snippet} — ${a.outcome}${a.message ? ` (${a.message})` : ""}`,
        )
        .join("\n"),
    );
  }

  return parts.join("\n") + result.warningsText;
}

export function formatSearch(result: LeanSearchResult): string {
  const parts: string[] = [];
  if (result.focus) parts.push(formatFocusLine(result.focus));
  if (result.proofStateStatus)
    parts.push(`Proof state source: ${result.proofStateStatus}`);
  parts.push(`\nCandidates (${result.candidates.length}):`);

  for (const [i, candidate] of result.candidates.entries()) {
    const lines = [
      `\n${i + 1}. ${candidate.name} (${candidate.kind}, score ${candidate.score})`,
    ];
    lines.push(`   why: ${candidate.matchReason}`);
    if (candidate.statement) lines.push(`   type: ${candidate.statement}`);
    if (candidate.suggestedSnippet)
      lines.push(`   try: ${candidate.suggestedSnippet}`);
    if (candidate.docstring) lines.push(`   doc: ${candidate.docstring}`);
    if (candidate.examples && candidate.examples.length > 0) {
      lines.push(
        `   used at: ${candidate.examples.map((e) => `${e.file}:${e.line}`).join(", ")}`,
      );
    }
    parts.push(lines.join("\n"));
  }

  if (result.searchTruncated) {
    parts.push(
      "\n(search hit its fan-out cap; the candidate set may be incomplete)",
    );
  }
  return parts.join("\n") + result.warningsText;
}

export function formatTry(result: LeanTryResult): string {
  const parts: string[] = [
    formatFocusLine(result.focus),
    `Freshness: ${result.freshness}`,
    "",
  ];
  for (const row of result.rows) {
    const marker = row.acceptable ? "OK " : "   ";
    parts.push(`${marker}[${row.status}] ${row.snippet}`);
    if (row.message) parts.push(`    error: ${row.message}`);
    if (row.previousFailure)
      parts.push(`    (repeat of earlier failure: ${row.previousFailure})`);
    if (row.goalsAfter && row.goalsAfter.length > 0) {
      parts.push(`    remaining goals: ${row.goalsAfter.join(" | ")}`);
    }
  }
  const acceptable = result.rows.filter((row) => row.acceptable);
  if (acceptable.length > 0) {
    parts.push(
      `\n${acceptable.length} candidate(s) meet the accept bar. Commit one with lean_apply.`,
    );
  } else {
    parts.push(
      "\nNo candidate met the accept bar. Try lean_search for more ideas.",
    );
  }
  if (result.candidatesTruncated) {
    parts.push(
      "(backend candidate cap reached; some candidates were not returned)",
    );
  }
  return parts.join("\n") + result.warningsText;
}

export function formatApply(result: LeanApplyResult): string {
  if (result.applied) {
    const parts = [
      `Applied and verified: ${result.edit.snippet}`,
      formatFocusLine(result.focus),
      `Inserted after line ${result.edit.insertedAfterLine} in ${result.edit.path}`,
    ];
    if (result.axioms) parts.push(`Axioms: ${JSON.stringify(result.axioms)}`);
    parts.push(
      "\nRe-run lean_state to observe the new goal before the next step.",
    );
    return parts.join("\n") + result.warningsText;
  }
  const parts = [
    `Not applied: ${result.message}`,
    formatFocusLine(result.focus),
  ];
  if (result.diagnostics && result.diagnostics.length > 0) {
    parts.push("\nDiagnostics:");
    parts.push(
      result.diagnostics
        .slice(0, 10)
        .map((d) => `- [${d.severity}] ${d.message}`)
        .join("\n"),
    );
  }
  return parts.join("\n") + result.warningsText;
}

export function formatVerify(result: LeanVerifyResult): string {
  const s = result.summary;
  const parts = [
    `Verification: ${s.verified}/${s.requested} verified, ${s.failed} failed, ${s.needs_build} needs_build, ${s.unknown_coverage} unknown coverage`,
    `Freshness: ${result.freshness}`,
    "",
  ];
  for (const row of result.results) {
    parts.push(`[${row.verification_status}] ${row.declaration ?? row.id}`);
    const diags = row.diagnostics?.diagnostics ?? [];
    for (const d of diags.slice(0, 5)) {
      parts.push(`    [${d.severity}] ${d.message}`);
    }
  }
  const unknown = result.coverage?.unknown ?? [];
  if (unknown.length > 0) {
    parts.push("\nCoverage gaps:");
    for (const gap of unknown) {
      parts.push(
        `- ${gap.file ?? "(unknown file)"}: ${gap.reason ?? "unknown"}` +
          (gap.next_action ? ` — next: ${gap.next_action}` : ""),
      );
    }
  }
  return parts.join("\n") + result.warningsText;
}

/** Subset of state useful for tool renderers and ledger reconstruction. */
export function stateSnapshotDetails(state: LeanSessionState): {
  sessionState: LeanSessionState;
} {
  return { sessionState: structuredClone(state) };
}
