/**
 * Shared helpers for the lean_* tool wrappers.
 */

import { truncateHead } from "@earendil-works/pi-coding-agent";
import type { ProofPositionSelector } from "../../../src/backend/types";

/** Strip a leading `@` from model-provided paths. */
export function stripAt(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("@") ? path.slice(1) : path;
}

interface ProofPositionArg {
  kind: "default" | "index" | "after_text";
  index?: number;
  text?: string;
  occurrence?: number;
}

/** Convert the tool-schema proof position to the backend selector. */
export function toProofPosition(
  arg: ProofPositionArg | undefined,
): ProofPositionSelector | undefined {
  if (!arg) return undefined;
  switch (arg.kind) {
    case "default":
      return { kind: "default" };
    case "index":
      return { kind: "index", index: arg.index ?? 0 };
    case "after_text":
      return {
        kind: "after_text",
        text: arg.text ?? "",
        occurrence: arg.occurrence,
      };
  }
}

const MAX_CONTENT_BYTES = 40_000;
const MAX_CONTENT_LINES = 600;

/** Truncate tool content; the Lean outputs are bounded but goals can be big. */
export function truncateText(text: string): string {
  const truncated = truncateHead(text, {
    maxBytes: MAX_CONTENT_BYTES,
    maxLines: MAX_CONTENT_LINES,
  });
  if (!truncated.truncated) return text;
  return (
    truncated.content +
    `\n\n[Output truncated: ${truncated.outputLines}/${truncated.totalLines} lines. ` +
    "Narrow the query or inspect the declaration directly.]"
  );
}
