/**
 * lean_search: semantic discovery for the current goal or explicit text.
 * Composes proof_search (ranked candidates), declaration inspection
 * (statements/docstrings), and reference search (usage examples) behind one
 * normalized result.
 */

import { formatWarnings, requireData } from "../../backend";
import type { RenderedText, SemanticIssue } from "../../backend/types";
import type { ProofFocus } from "../../proof-state";
import { FocusError, resolveFocus } from "../../proof-state";
import type { LeanHarness } from "../harness";

export interface LeanSearchParams {
  /** Free text or explicit goal/type text. Required when `for` is "text". */
  query?: string;
  /** Search target: the focused goal (default) or explicit text. */
  for?: "current_goal" | "text";
  /** Include nearby usage examples from the reference index. */
  includeExamples?: boolean;
  /** Max candidates (backend cap is 20). */
  limit?: number;
}

export interface SearchCandidate {
  name: string;
  kind: string;
  module?: string;
  score: number;
  matchReason: string;
  suggestedSnippet?: string;
  statement?: string;
  docstring?: string;
  examples?: Array<{ file: string; line: number; kind: string }>;
}

export interface LeanSearchResult {
  focus?: ProofFocus;
  proofStateStatus?: string;
  candidates: SearchCandidate[];
  searchTruncated: boolean;
  warnings: SemanticIssue[];
  warningsText: string;
}

/** How many candidates get full statement/docstring enrichment. */
const ENRICH_LIMIT = 5;
/** How many enriched candidates get usage examples. */
const EXAMPLE_LIMIT = 3;

interface RawProofSearchCandidate {
  name: string;
  kind: string;
  module?: string;
  score: number;
  match_reason: string;
  suggested_snippet?: string;
}

export async function leanSearch(
  harness: LeanHarness,
  params: LeanSearchParams,
  signal?: AbortSignal,
): Promise<LeanSearchResult> {
  await harness.ensureReady();

  const mode = params.for ?? (params.query ? "text" : "current_goal");
  const limit = Math.min(params.limit ?? 8, 20);

  let focus: ProofFocus | undefined;
  const searchArgs: Record<string, unknown> = {
    kind: "proof_search",
    mode: "next_step",
    limit,
  };

  if (mode === "current_goal") {
    focus = resolveFocus(harness.state, {});
    searchArgs.file = focus.file;
    searchArgs.declaration = focus.declaration;
    searchArgs.proof_position = focus.proofPosition;
  } else {
    if (!params.query) {
      throw new FocusError(
        'lean_search with `for: "text"` requires a `query`.',
      );
    }
    searchArgs.goal = params.query;
    // Reuse the focused file when present so imports resolve locally.
    if (harness.state.focus) {
      searchArgs.file = harness.state.focus.file;
    }
  }

  const envelope = await harness.client.lookup(searchArgs, signal);
  const { data, warnings } = requireData(envelope, "lean_lookup(proof_search)");

  const rawCandidates =
    (data.candidates as RawProofSearchCandidate[] | undefined) ?? [];
  const diagnostics = data.diagnostics as
    | { proof_state_status?: string; search_truncated?: boolean }
    | undefined;

  const candidates: SearchCandidate[] = rawCandidates.map((raw) => ({
    name: raw.name,
    kind: raw.kind,
    module: raw.module,
    score: raw.score,
    matchReason: raw.match_reason,
    suggestedSnippet: raw.suggested_snippet,
  }));

  // Enrich the top candidates with exact statements and docstrings.
  const enrichPool = candidates.slice(0, ENRICH_LIMIT);
  await Promise.all(
    enrichPool.map(async (candidate) => {
      try {
        const declEnvelope = await harness.client.lookup(
          {
            kind: "declaration",
            name: candidate.name,
            fields: ["statement", "docstring"],
            ...(focus ? { file: focus.file } : {}),
          },
          signal,
        );
        const decl = requireData(declEnvelope, "lean_lookup(declaration)").data;
        candidate.statement = textField(decl.statement);
        candidate.docstring = textField(decl.docstring);
      } catch {
        // Enrichment is best-effort; the ranked row already carries the name,
        // kind, and match reason.
      }
    }),
  );

  if (params.includeExamples) {
    await Promise.all(
      candidates.slice(0, EXAMPLE_LIMIT).map(async (candidate) => {
        try {
          const refEnvelope = await harness.client.lookup(
            {
              kind: "references",
              name: candidate.name,
              scope: "project",
              limit: 5,
            },
            signal,
          );
          const refs = requireData(refEnvelope, "lean_lookup(references)").data;
          const hits =
            (refs.references as Array<{
              file: string;
              line: number;
              kind: string;
            }>) ?? [];
          candidate.examples = hits
            .filter((hit) => hit.kind === "ref")
            .map((hit) => ({ file: hit.file, line: hit.line, kind: hit.kind }));
        } catch {
          // Reference index may be stale or missing; examples are optional.
        }
      }),
    );
  }

  return {
    focus,
    proofStateStatus: diagnostics?.proof_state_status,
    candidates,
    searchTruncated: diagnostics?.search_truncated ?? false,
    warnings,
    warningsText: formatWarnings(warnings),
  };
}

function textField(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  const rendered = value as RenderedText;
  return typeof rendered.value === "string" ? rendered.value : undefined;
}
