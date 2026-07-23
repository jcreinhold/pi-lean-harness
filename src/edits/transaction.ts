/**
 * Transactional source edits for lean_apply.
 *
 * The backend (lean_trial) splices candidate snippets at a proof boundary in
 * memory. lean_apply reproduces that exact splice on disk: insert the tested
 * snippet text as a new tactic line at the boundary's source span, keeping
 * the original bytes available for rollback.
 */

import { readFile, writeFile } from "node:fs/promises";
import type { ProofBoundary, SourceSpan } from "../backend/types";

export interface PreparedEdit {
  /** Absolute path of the file to modify. */
  path: string;
  /** Exact file bytes before the edit. */
  originalContent: string;
  /** File bytes after the edit. */
  newContent: string;
  /** The snippet that was inserted. */
  snippet: string;
  /** Boundary the snippet was inserted at. */
  boundary: ProofBoundary;
  /** How the snippet landed: inserted at the boundary or replacing its tactic. */
  mode: EditMode;
}

export type EditMode = "insert" | "replace";

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

/**
 * Compute the post-edit content without touching disk.
 *
 * Insertion rule: an "entry" boundary inserts a new tactic line *before* the
 * boundary line (the pristine entry point of the tactic block); any other
 * boundary inserts *after* the boundary's last line (i.e. after the tactic
 * that produced this state). Indentation follows the boundary's start column.
 */
export function computeEdit(
  path: string,
  originalContent: string,
  snippet: string,
  boundary: ProofBoundary,
  mode: EditMode = "insert",
): PreparedEdit {
  const span: SourceSpan = boundary.source;
  const endsWithNewline = originalContent.endsWith("\n");
  const lines = originalContent.split("\n");
  if (endsWithNewline) lines.pop(); // drop the trailing empty segment

  if (
    span.start_line < 1 ||
    span.end_line > lines.length ||
    span.end_line < span.start_line
  ) {
    throw new EditError(
      `Proof boundary span (lines ${span.start_line}-${span.end_line}) is outside ` +
        `${path} (${lines.length} lines). The file likely changed since the proof ` +
        "context was read; re-run lean_state.",
    );
  }

  const next =
    mode === "replace"
      ? replaceAtSpan(lines, span, snippet)
      : insertAtBoundary(lines, span, snippet, boundary.kind);
  const newContent = next.join("\n") + (endsWithNewline ? "\n" : "");

  return { path, originalContent, newContent, snippet, boundary, mode };
}

/** Insert the snippet as new tactic line(s) at the boundary. */
function insertAtBoundary(
  lines: string[],
  span: SourceSpan,
  snippet: string,
  boundaryKind: string,
): string[] {
  const indent = " ".repeat(Math.max(0, span.start_column - 1));
  const snippetLines = snippet
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : indent + line.trimStart()));

  const insertAt =
    boundaryKind === "entry" ? span.start_line - 1 : span.end_line;
  return [
    ...lines.slice(0, insertAt),
    ...snippetLines,
    ...lines.slice(insertAt),
  ];
}

/**
 * Replace the boundary tactic's exact span (e.g. a `sorry` placeholder) with
 * the snippet. Column-aware: content before the span on the first line and
 * after it on the last line is preserved. When the span starts after pure
 * whitespace, that whitespace is reused as the snippet's indentation; when
 * the span is inline (e.g. `:= by sorry`), the snippet is spliced in place.
 */
function replaceAtSpan(
  lines: string[],
  span: SourceSpan,
  snippet: string,
): string[] {
  const startIdx = span.start_line - 1;
  const endIdx = span.end_line - 1;
  const prefix = (lines[startIdx] ?? "").slice(0, span.start_column - 1);
  const suffix = (lines[endIdx] ?? "").slice(span.end_column - 1);

  const trimmed = snippet.split("\n").map((line) => line.trim());
  let newLines: string[];
  if (/^\s*$/.test(prefix)) {
    // Span starts after pure indentation: reuse it for every snippet line.
    newLines = trimmed.map((line) => (line === "" ? "" : prefix + line));
    const last = newLines.length - 1;
    newLines[last] = (newLines[last] ?? "") + suffix;
  } else {
    // Inline span (e.g. `:= by sorry`): splice around the snippet as-is.
    newLines = [...trimmed];
    newLines[0] = prefix + (newLines[0] ?? "");
    const last = newLines.length - 1;
    newLines[last] = (newLines[last] ?? "") + suffix;
  }

  return [...lines.slice(0, startIdx), ...newLines, ...lines.slice(endIdx + 1)];
}

/** Read the current file bytes. */
export async function readSource(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/** Write the prepared edit to disk. */
export async function commitEdit(edit: PreparedEdit): Promise<void> {
  await writeFile(edit.path, edit.newContent, "utf8");
}
