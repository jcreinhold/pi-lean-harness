/**
 * lean_verify — verification gate for the focused declaration, explicit
 * declarations, whole files, or the git-changed set.
 */

import { ToolBody, ToolCallHeader, ToolFooter } from "@aliou/pi-utils-ui";
import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defineTool, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { LeanHarness } from "../../../src/core";
import { leanVerify } from "../../../src/core";
import type { LeanSessionState } from "../../../src/proof-state";
import { formatVerify } from "../format";
import { truncateText } from "./shared";

const parameters = Type.Object({
  scope: Type.Optional(
    StringEnum(["focus", "declaration", "file", "changed"] as const, {
      description:
        '"focus" (default when a focus is set) verifies the focused declaration; ' +
        '"declaration" verifies an explicit declaration; "file" verifies every declaration ' +
        'in a file; "changed" verifies the git-changed set.',
    }),
  ),
  declaration: Type.Optional(
    Type.String({ description: 'Declaration name for scope "declaration"' }),
  ),
  file: Type.Optional(
    Type.String({
      description:
        'Project-relative file for scopes "file"/"declaration"/"changed"',
    }),
  ),
  base: Type.Optional(
    Type.String({
      description: 'Git base for scope "changed" (default "HEAD")',
    }),
  ),
  includeUntracked: Type.Optional(
    Type.Boolean({
      description:
        'Include untracked .lean files in scope "changed" (default true)',
    }),
  ),
  allowSorry: Type.Optional(
    Type.Boolean({
      description: "Accept declarations containing sorry (default false)",
    }),
  ),
  reportAxioms: Type.Optional(
    Type.Boolean({ description: "Report axiom dependencies (default true)" }),
  ),
});

interface LeanVerifyDetails {
  verified: number;
  requested: number;
  failed: number;
  rows: Array<{ declaration?: string; status: string }>;
  sessionState: LeanSessionState;
}

export function createLeanVerifyTool(getHarness: () => LeanHarness) {
  return defineTool({
    name: "lean_verify",
    label: "Lean Verify",
    description:
      "Verify Lean declarations with sorry policy and optional axiom reporting: the " +
      "focused declaration, an explicit declaration, a whole file, or the git-changed " +
      "set. Does not edit files.",
    promptSnippet:
      "Verify Lean declarations (focus, explicit, file, or git-changed set)",
    promptGuidelines: [
      'Use lean_verify with scope "changed" before declaring a proof task complete, and inspect any coverage gaps it reports.',
    ],
    parameters,

    async execute(
      _toolCallId,
      params,
      signal,
      onUpdate,
    ): Promise<AgentToolResult<LeanVerifyDetails>> {
      onUpdate?.({
        content: [{ type: "text", text: "Verifying..." }],
        details: {
          verified: 0,
          requested: 0,
          failed: 0,
          rows: [],
          sessionState: structuredClone(getHarness().state),
        },
      });
      const harness = getHarness();
      const result = await leanVerify(
        harness,
        {
          scope: params.scope,
          declaration: params.declaration,
          file: params.file,
          base: params.base,
          includeUntracked: params.includeUntracked,
          allowSorry: params.allowSorry,
          reportAxioms: params.reportAxioms,
        },
        signal,
      );
      const text = truncateText(formatVerify(result));
      return {
        content: [{ type: "text", text }],
        details: {
          verified: result.summary.verified,
          requested: result.summary.requested,
          failed: result.summary.failed,
          rows: result.results.map((row) => ({
            declaration: row.declaration,
            status: row.verification_status,
          })),
          sessionState: structuredClone(harness.state),
        },
      };
    },

    renderCall(args, theme) {
      return new ToolCallHeader(
        {
          toolName: "Lean Verify",
          action: (args.scope as string | undefined) ?? "focus",
          mainArg:
            (args.declaration as string | undefined) ??
            (args.file as string | undefined),
        },
        theme,
      );
    },

    renderResult(result, options, theme) {
      if (options.isPartial) {
        return new Text(theme.fg("muted", "Lean Verify: elaborating..."), 0, 0);
      }
      const { details } = result;
      if (!details?.rows) {
        const textBlock = result.content.find((c) => c.type === "text");
        const message =
          textBlock?.type === "text" ? textBlock.text : "lean_verify failed";
        return new Text(theme.fg("error", message), 0, 0);
      }
      const ok = details.failed === 0 && details.verified === details.requested;
      const fields = [
        {
          label: "Summary",
          value: theme.fg(
            ok ? "success" : "warning",
            `${details.verified}/${details.requested} verified`,
          ),
          showCollapsed: true,
        },
        ...details.rows.map((row) => ({
          label: row.status,
          value: row.declaration ?? "(unknown)",
          showCollapsed: false,
        })),
      ];
      const footerItems = [];
      if (!options.expanded && details.rows.length > 0) {
        footerItems.push({ value: keyHint("app.tools.expand", "to expand") });
      }
      return new ToolBody(
        {
          fields,
          footer:
            footerItems.length > 0
              ? new ToolFooter(theme, { items: footerItems })
              : undefined,
          includeSpacerBeforeFooter: true,
        },
        options,
        theme,
      );
    },
  });
}
