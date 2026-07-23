/**
 * lean_try — non-mutating tactic trials against the focused proof state.
 */

import { ToolBody, ToolCallHeader, ToolFooter } from "@aliou/pi-utils-ui";
import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defineTool, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { LeanHarness } from "../../../src/core";
import { leanTry } from "../../../src/core";
import type { LeanSessionState } from "../../../src/proof-state";
import { formatTry } from "../format";
import { focusFields } from "../schemas";
import { stripAt, toProofPosition, truncateText } from "./shared";

const parameters = Type.Object({
  candidates: Type.Array(
    Type.String({ description: "Tactic or proof snippet to try" }),
    {
      description:
        "Tactics to test in memory at the focused proof position (max 16 per call)",
      minItems: 1,
    },
  ),
  accept: Type.Optional(
    StringEnum(["close", "progress", "any"] as const, {
      description:
        'Acceptance bar: "close" (default) requires closing the goal; "progress" also ' +
        'accepts forward progress; "any" accepts anything that elaborates.',
    }),
  ),
  ...focusFields,
});

interface LeanTryDetails {
  rows: Array<{ snippet: string; status: string; acceptable: boolean }>;
  sessionState: LeanSessionState;
}

export function createLeanTryTool(getHarness: () => LeanHarness) {
  return defineTool({
    name: "lean_try",
    label: "Lean Try",
    description:
      "Test one or more tactics in memory at the focused proof position. Never edits " +
      "files. Exact repeat failures are skipped from the shared ledger; outcomes are " +
      "recorded so the agent avoids retrying dead ends.",
    promptSnippet:
      "Test tactic candidates against the current Lean goal without editing",
    promptGuidelines: [
      "Use lean_try to test tactics before editing; only commit successful candidates with lean_apply.",
      "Batch several candidates in one lean_try call instead of calling it once per tactic.",
      "Prefer one tactic per candidate so a failure localizes to a single step; after a multi-tactic candidate fails, decompose it rather than re-guessing.",
    ],
    parameters,

    async execute(
      _toolCallId,
      params,
      signal,
      onUpdate,
    ): Promise<AgentToolResult<LeanTryDetails>> {
      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Trying ${params.candidates.length} candidate(s)...`,
          },
        ],
        details: {
          rows: [],
          sessionState: structuredClone(getHarness().state),
        },
      });
      const harness = getHarness();
      const result = await leanTry(
        harness,
        {
          candidates: params.candidates,
          accept: params.accept,
          file: stripAt(params.file),
          declaration: params.declaration,
          proofPosition: toProofPosition(params.proofPosition),
        },
        signal,
      );
      const text = truncateText(formatTry(result));
      return {
        content: [{ type: "text", text }],
        details: {
          rows: result.rows.map((row) => ({
            snippet: row.snippet,
            status: row.status,
            acceptable: row.acceptable,
          })),
          sessionState: structuredClone(harness.state),
        },
      };
    },

    renderCall(args, theme) {
      const candidates = (args.candidates as string[] | undefined) ?? [];
      return new ToolCallHeader(
        {
          toolName: "Lean Try",
          mainArg: candidates[0],
          optionArgs:
            candidates.length > 1
              ? [{ label: "+", value: `${candidates.length - 1} more` }]
              : [],
        },
        theme,
      );
    },

    renderResult(result, options, theme) {
      if (options.isPartial) {
        return new Text(
          theme.fg("muted", "Lean Try: testing candidates..."),
          0,
          0,
        );
      }
      const { details } = result;
      if (!details?.rows) {
        const textBlock = result.content.find((c) => c.type === "text");
        const message =
          textBlock?.type === "text" ? textBlock.text : "lean_try failed";
        return new Text(theme.fg("error", message), 0, 0);
      }
      const fields = details.rows.map((row) => ({
        label: row.acceptable ? "ok" : row.status,
        value: row.snippet,
        showCollapsed: true,
      }));
      const footerItems = [];
      if (!options.expanded && details.rows.length > 6) {
        footerItems.push({ value: keyHint("app.tools.expand", "to expand") });
      }
      return new ToolBody(
        {
          fields,
          footer:
            footerItems.length > 0
              ? new ToolFooter(theme, { items: footerItems })
              : undefined,
          includeSpacerBeforeFooter: fields.length > 0,
        },
        options,
        theme,
      );
    },
  });
}
