/**
 * The proof ledger: successful steps, failed attempts, and verification
 * records for the active proof. Snapshots are embedded in every façade tool
 * result's `details.sessionState` so the ledger follows the session branch
 * (fork, tree navigation, compaction) instead of living in fragile globals.
 */

import type {
  AttemptOutcome,
  LeanSessionState,
  ProofAttempt,
  ProofFocus,
  VerificationRecord,
} from "./types";

/** Maximum attempts retained per ledger direction. */
export const LEDGER_CAP = 50;

export function createEmptyState(): LeanSessionState {
  return { successfulSteps: [], failedAttempts: [] };
}

export function setFocus(state: LeanSessionState, focus: ProofFocus): void {
  state.focus = focus;
}

export function setBackendIdentity(
  state: LeanSessionState,
  identity: { projectRoot?: string; toolchain?: string },
): void {
  if (identity.projectRoot !== undefined)
    state.projectRoot = identity.projectRoot;
  if (identity.toolchain !== undefined) state.toolchain = identity.toolchain;
}

/**
 * Record an attempt. Failed attempts are deduplicated by
 * (goal fingerprint, snippet): a repeat moves the row to the end instead of
 * growing the ledger. Both directions are capped at LEDGER_CAP entries.
 */
export function recordAttempt(
  state: LeanSessionState,
  attempt: Omit<ProofAttempt, "timestamp"> & { timestamp?: string },
): ProofAttempt {
  const row: ProofAttempt = {
    ...attempt,
    timestamp: attempt.timestamp ?? now(),
  };
  const success = row.outcome === "closed" || row.outcome === "applied";
  const list = success ? state.successfulSteps : state.failedAttempts;

  const existing = list.findIndex(
    (entry) =>
      entry.goalFingerprint === row.goalFingerprint &&
      entry.snippet === row.snippet &&
      entry.sourceHash === row.sourceHash,
  );
  if (existing >= 0) list.splice(existing, 1);
  list.push(row);
  if (list.length > LEDGER_CAP) list.splice(0, list.length - LEDGER_CAP);
  return row;
}

export function recordVerification(
  state: LeanSessionState,
  record: VerificationRecord,
): void {
  state.lastVerification = record;
}

/** True when this exact snippet already failed against this goal state.
 * When `sourceHash` is supplied, the prior failure must share it, so an edit
 * that leaves the goal text unchanged (e.g. adding an import) does not lock
 * out a now-valid retry. */
export function hasFailedBefore(
  state: LeanSessionState,
  goalFingerprint: string,
  snippet: string,
  sourceHash?: string,
): ProofAttempt | undefined {
  return state.failedAttempts.find(
    (entry) =>
      entry.goalFingerprint === goalFingerprint &&
      entry.snippet === snippet &&
      entry.sourceHash === sourceHash,
  );
}

/** Failures recorded against the given goal fingerprint, newest last.
 * When `sourceHash` is supplied, only failures with that source hash are
 * returned, so the "previous failures" view matches the live source. */
export function failuresForGoal(
  state: LeanSessionState,
  goalFingerprint: string,
  sourceHash?: string,
): ProofAttempt[] {
  return state.failedAttempts.filter(
    (entry) =>
      entry.goalFingerprint === goalFingerprint &&
      entry.sourceHash === sourceHash,
  );
}

/** Serializable snapshot for tool-result details. */
export function snapshotState(state: LeanSessionState): LeanSessionState {
  return structuredClone(state);
}

/**
 * Merge a snapshot from a previous tool result into `state`. Later snapshots
 * win wholesale; the ledger arrays are taken as-is (they are cumulative).
 */
export function applySnapshot(
  state: LeanSessionState,
  snapshot: Partial<LeanSessionState>,
): void {
  if (snapshot.projectRoot !== undefined)
    state.projectRoot = snapshot.projectRoot;
  if (snapshot.toolchain !== undefined) state.toolchain = snapshot.toolchain;
  if (snapshot.focus !== undefined) state.focus = snapshot.focus;
  if (snapshot.sourceHash !== undefined) state.sourceHash = snapshot.sourceHash;
  if (snapshot.goalFingerprint !== undefined)
    state.goalFingerprint = snapshot.goalFingerprint;
  if (Array.isArray(snapshot.successfulSteps)) {
    state.successfulSteps = [...snapshot.successfulSteps];
  }
  if (Array.isArray(snapshot.failedAttempts)) {
    state.failedAttempts = [...snapshot.failedAttempts];
  }
  if (snapshot.lastVerification !== undefined)
    state.lastVerification = snapshot.lastVerification;
}

/**
 * Minimal structural view of a session branch entry, so the ledger can be
 * rebuilt without importing Pi types into src/.
 */
export interface BranchEntryLike {
  type: string;
  message?: {
    role?: string;
    toolName?: string;
    details?: unknown;
  };
}

/** Tool names whose results carry session-state snapshots. */
const LEDGER_TOOL_PREFIX = "lean_";

/**
 * Rebuild proof state by folding every snapshot on the active branch, in
 * order. Returns a fresh state reflecting the branch's latest ledger.
 */
export function rebuildStateFromBranch(
  entries: readonly BranchEntryLike[],
): LeanSessionState {
  const state = createEmptyState();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message?.role !== "toolResult") continue;
    if (
      typeof message.toolName !== "string" ||
      !message.toolName.startsWith(LEDGER_TOOL_PREFIX)
    ) {
      continue;
    }
    const details = message.details as
      | { sessionState?: Partial<LeanSessionState> }
      | undefined;
    if (details?.sessionState && typeof details.sessionState === "object") {
      applySnapshot(state, details.sessionState);
    }
  }
  return state;
}

function now(): string {
  return new Date().toISOString();
}

export type { AttemptOutcome };
