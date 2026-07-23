import type {
  ProofPositionSelector,
  TrialCandidateStatus,
  VerificationStatus,
} from "../backend/types";

/** The active proof target. Set explicitly by the agent, then reused. */
export interface ProofFocus {
  /** Project-relative .lean path. */
  file: string;
  /** Fully-qualified declaration name. */
  declaration: string;
  /** Proof position within the declaration's tactic block. */
  proofPosition: ProofPositionSelector;
}

export type AttemptOutcome =
  | TrialCandidateStatus
  | "applied"
  | "rolled_back"
  | "kept_unverified";

export interface ProofAttempt {
  file: string;
  declaration: string;
  /** Fingerprint of the goal state the snippet ran against. */
  goalFingerprint: string;
  snippet: string;
  outcome: AttemptOutcome;
  /** First diagnostic message or short summary, when relevant. */
  message?: string;
  timestamp: string;
}

export interface VerificationRecord {
  file: string;
  declaration: string;
  status: VerificationStatus;
  timestamp: string;
}

/**
 * Shared proof-session state. Every façade tool reads and writes this model;
 * snapshots travel in tool-result `details` so the state can be rebuilt from
 * the active session branch after fork, compaction, or reload.
 */
export interface LeanSessionState {
  projectRoot?: string;
  toolchain?: string;
  focus?: ProofFocus;
  /** sha256 of the focus file's bytes at last observation. */
  sourceHash?: string;
  /** Fingerprint of the current goal text at the focus. */
  goalFingerprint?: string;
  successfulSteps: ProofAttempt[];
  failedAttempts: ProofAttempt[];
  lastVerification?: VerificationRecord;
}
