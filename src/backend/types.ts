/**
 * Types mirroring the lean-host-mcp semantic response envelope and the data
 * payloads the harness normalizes. Field names match the server's serde
 * output (snake_case).
 */

/** One issue row from the semantic envelope `errors` array. */
export interface SemanticIssue {
  code: string;
  message: string;
  severity?: "error" | "warning" | string;
  next_action?: string;
  retryable?: boolean;
  details?: unknown;
}

/** One artifact freshness row from the trust block. */
export interface ArtifactTrust {
  artifact: "source" | "olean" | "ilean" | "worker" | string;
  scope: "file" | "module" | "project" | "toolchain" | string;
  status:
    | "edit_fresh"
    | "build_fresh"
    | "stale_build"
    | "missing_build"
    | "unknown"
    | "not_applicable"
    | string;
  path?: string;
  module?: string;
  detail?: string;
  next_action?: string;
}

/** Trust block: provenance and freshness of the data in `data`. */
export interface SemanticTrust {
  project_root: string;
  session_id: string;
  lean_toolchain: string;
  artifacts?: ArtifactTrust[];
}

/** The semantic response baseline returned by every lean-host-mcp tool. */
export interface SemanticEnvelope<T = unknown> {
  data: T | null;
  errors: SemanticIssue[];
  trust?: SemanticTrust;
}

export interface RenderedText {
  value: string;
  truncated: boolean;
}

export interface SourceSpan {
  start_line: number;
  start_column: number;
  end_line: number;
  end_column: number;
}

export interface LeanPosition {
  line: number;
  column: number;
  end_line?: number;
  end_column?: number;
}

export interface LeanDiagnostic {
  severity: "error" | "warning" | "info" | string;
  message: string;
  coordinate_space?: string;
  position?: LeanPosition | null;
  original_range?: SourceSpan;
  synthetic_range?: LeanPosition;
  file?: string;
  note?: string;
}

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
  info: number;
}

export interface DiagnosticsBlock {
  summary: DiagnosticSummary;
  diagnostics: LeanDiagnostic[];
  truncated: boolean;
}

export interface BlockedItem {
  id: string;
  message: string;
}

/** Selector for a proof position; mirrors ProofPositionSelector. */
export type ProofPositionSelector =
  | { kind: "default" }
  | { kind: "index"; index: number }
  | { kind: "after_text"; text: string; occurrence?: number };

export interface ProofBoundary {
  index: number;
  kind: string;
  selector: { kind: "default" } | { kind: "index"; index: number };
  source: SourceSpan;
  excerpt: RenderedText;
}

export interface LocalInfo {
  name: string;
  type_str?: RenderedText;
  value?: RenderedText;
}

/** `data` payload of `lean_context` (kind = "proof_position"). */
export interface ProofContextData {
  status: string;
  declaration_name?: string | null;
  namespace_name?: string | null;
  goals_before?: string[];
  goals_after?: string[];
  locals?: LocalInfo[];
  expected_type?: RenderedText | null;
  truncated?: boolean;
  proof_boundaries?: ProofBoundary[];
  proof_boundaries_truncated?: boolean;
  diagnostics?: DiagnosticsBlock;
  unavailable?: BlockedItem[];
  needs_build?: BlockedItem[];
  ambiguous?: unknown[];
}

export type TrialCandidateStatus =
  | "closed"
  | "progressed"
  | "failed"
  | "timeout"
  | "budget_exceeded"
  | "not_attempted"
  | "unsupported";

export interface TrialCandidate {
  id: string;
  status: TrialCandidateStatus;
  snippet?: string;
  diagnostics?: DiagnosticsBlock;
  goals_after?: string[];
  output?: RenderedText;
}

export interface TrialSummary {
  requested_candidates: number;
  returned_candidates: number;
  candidate_limit: number;
  candidates_truncated: boolean;
  partial: boolean;
  closed: number;
  progressed: number;
  failed: number;
  timeout: number;
  budget_exceeded: number;
  not_attempted: number;
  unsupported: number;
  output_truncated: number;
}

/** `data` payload of `lean_trial` (kind = "proof_step"). */
export interface ProofStepTrialData {
  candidates: TrialCandidate[];
  candidate_limit: number;
  candidates_truncated: boolean;
  summary: TrialSummary;
}

export type VerificationStatus =
  | "verified"
  | "has_sorry"
  | "has_unresolved_goals"
  | "has_diagnostics"
  | "not_found"
  | "ambiguous"
  | "needs_build"
  | "timeout"
  | "budget_exceeded"
  | "worker_recycled"
  | "unsupported";

export interface VerifyRow {
  id: string;
  file?: string;
  declaration?: string;
  reason?: string;
  verification_status: VerificationStatus;
  facts?: Record<string, unknown>;
  diagnostics?: DiagnosticsBlock;
}

export interface CoverageGap {
  file?: string;
  reason?: string;
  next_action?: string;
}

export interface VerifyCoverage {
  unknown?: CoverageGap[];
  deleted_files?: string[];
  renamed_files?: unknown[];
  truncated?: boolean;
}

/** `data` payload of `lean_verify`. */
export interface VerifyData {
  summary: {
    requested: number;
    verified: number;
    failed: number;
    needs_build: number;
    unknown_coverage: number;
    truncated: boolean;
  };
  results: VerifyRow[];
  coverage?: VerifyCoverage;
}

/** A verification target group for `lean_verify`. */
export type VerifyTarget =
  | { kind: "explicit"; file: string; declarations: string[] }
  | { kind: "file_all"; file: string }
  | { kind: "module_all"; module: string }
  | {
      kind: "changed";
      base: string;
      files?: string[];
      include_untracked?: boolean;
    };
