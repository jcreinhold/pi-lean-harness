/**
 * lean_verify: verification gate over explicit declarations, whole files,
 * modules, or the git-changed set. Records the outcome in the ledger.
 */

import { formatWarnings, freshnessSummary, requireData } from "../../backend";
import type {
  SemanticIssue,
  VerifyData,
  VerifyTarget,
} from "../../backend/types";
import { recordVerification, resolveFocus } from "../../proof-state";
import type { LeanHarness } from "../harness";

export interface LeanVerifyParams {
  /**
   * What to verify: the focused declaration (default), an explicit
   * declaration, a whole file, or the git-changed set.
   */
  scope?: "focus" | "declaration" | "file" | "changed";
  /** Declaration name for scope "declaration" (file defaults to focus). */
  declaration?: string;
  /** File for scope "file" (or the file of an explicit declaration). */
  file?: string;
  /** Git base for scope "changed" (default "HEAD"). */
  base?: string;
  includeUntracked?: boolean;
  allowSorry?: boolean;
  reportAxioms?: boolean;
}

export interface LeanVerifyResult {
  summary: VerifyData["summary"];
  results: VerifyData["results"];
  coverage?: VerifyData["coverage"];
  freshness: string;
  warnings: SemanticIssue[];
  warningsText: string;
}

export async function leanVerify(
  harness: LeanHarness,
  params: LeanVerifyParams,
  signal?: AbortSignal,
): Promise<LeanVerifyResult> {
  await harness.ensureReady();
  const scope = params.scope ?? (harness.state.focus ? "focus" : "changed");

  let targets: VerifyTarget[];
  switch (scope) {
    case "focus": {
      const focus = resolveFocus(harness.state, {});
      targets = [
        {
          kind: "explicit",
          file: focus.file,
          declarations: [focus.declaration],
        },
      ];
      break;
    }
    case "declaration": {
      if (!params.declaration) {
        throw new Error(
          'lean_verify with scope "declaration" requires `declaration`.',
        );
      }
      const file = params.file ?? harness.state.focus?.file;
      if (!file) {
        throw new Error(
          'lean_verify with scope "declaration" needs a file: provide `file` or set a focus first.',
        );
      }
      targets = [
        { kind: "explicit", file, declarations: [params.declaration] },
      ];
      break;
    }
    case "file": {
      const file = params.file ?? harness.state.focus?.file;
      if (!file) {
        throw new Error(
          'lean_verify with scope "file" requires `file` (or a set focus).',
        );
      }
      targets = [{ kind: "file_all", file }];
      break;
    }
    case "changed": {
      targets = [
        {
          kind: "changed",
          base: params.base ?? "HEAD",
          ...(params.file ? { files: [params.file] } : {}),
          include_untracked: params.includeUntracked ?? true,
        },
      ];
      break;
    }
  }

  const envelope = await harness.client.verify(
    {
      targets,
      allowSorry: params.allowSorry ?? false,
      reportAxioms: params.reportAxioms ?? true,
    },
    signal,
  );
  const { data, warnings, trust } = requireData(envelope, "lean_verify");

  // Record verification for any row matching the current focus.
  const focus = harness.state.focus;
  const focusRow = focus
    ? data.results.find((r) => r.declaration === focus.declaration)
    : undefined;
  if (focus && focusRow) {
    recordVerification(harness.state, {
      file: focus.file,
      declaration: focus.declaration,
      status: focusRow.verification_status,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    summary: data.summary,
    results: data.results,
    coverage: data.coverage,
    freshness: freshnessSummary(trust),
    warnings,
    warningsText: formatWarnings(warnings),
  };
}
