import { createHash } from "node:crypto";
import type { ProofContextData } from "../backend/types";

/** sha256 hex digest of text (file bytes, goal text). */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Fingerprint a proof context by its goal text. Two contexts with the same
 * goals are treated as the same proof-search state for ledger purposes.
 */
export function goalFingerprint(context: ProofContextData): string {
  const goals = [
    ...(context.goals_before ?? []),
    ...(context.goals_after ?? []),
  ];
  return sha256(goals.join("\n---\n"));
}

/** Fingerprint raw goal text (for contexts where only goals are known). */
export function goalTextFingerprint(goals: string[]): string {
  return sha256(goals.join("\n---\n"));
}
