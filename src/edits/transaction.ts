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
}

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

  const indent = " ".repeat(Math.max(0, span.start_column - 1));
  const snippetLines = snippet
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : indent + line.trimStart()));

  const insertAt =
    boundary.kind === "entry" ? span.start_line - 1 : span.end_line;
  const next = [
    ...lines.slice(0, insertAt),
    ...snippetLines,
    ...lines.slice(insertAt),
  ];
  const newContent = next.join("\n") + (endsWithNewline ? "\n" : "");

  return { path, originalContent, newContent, snippet, boundary };
}

/** Read the current file bytes. */
export async function readSource(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/** Write the prepared edit to disk. */
export async function commitEdit(edit: PreparedEdit): Promise<void> {
  await writeFile(edit.path, edit.newContent, "utf8");
}
