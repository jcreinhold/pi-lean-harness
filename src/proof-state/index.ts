export { goalFingerprint, goalTextFingerprint, sha256 } from "./fingerprint";
export {
  FocusError,
  type FocusOverride,
  focusChanged,
  resolveFocus,
} from "./focus";
export {
  applySnapshot,
  type BranchEntryLike,
  createEmptyState,
  failuresForGoal,
  hasFailedBefore,
  LEDGER_CAP,
  rebuildStateFromBranch,
  recordAttempt,
  recordVerification,
  setBackendIdentity,
  setFocus,
  snapshotState,
} from "./ledger";
export type {
  AttemptOutcome,
  LeanSessionState,
  ProofAttempt,
  ProofFocus,
  VerificationRecord,
} from "./types";
