/**
 * lean_apply — commit a successful proof step: trial, atomic edit, verify,
 * and rollback on failure. The only tool that writes source.
 */

import { ToolBody, ToolCallHeader } from "@aliou/pi-utils-ui";
import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  defineTool,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { LeanApplyResult, LeanHarness } from "../../../src/core";
import { leanApply } from "../../../src/core";
import type { LeanSessionState } from "../../../src/proof-state";
import { formatApply } from "../format";
import { focusFields } from "../schemas";
import { stripAt, toProofPosition, truncateText } from "./shared";

const parameters = Type.Object({
  candidate: Type.String({
    description:
      "Exact tactic text to commit. It is re-tested before editing; the file is only " +
      "modified when the trial succeeds.",
  }),
  require: Type.Optional(
    StringEnum(["close_current_goal", "make_progress"] as const, {
      description:
        '"close_current_goal" (default) only applies candidates that close the goal; ' +
        '"make_progress" also applies candidates that make forward progress.',
    }),
  ),
  mode: Type.Optional(
    StringEnum(["auto", "insert", "replace"] as const, {
      description:
        '"auto" (default) replaces the boundary tactic when it is a `sorry`/`admit` ' +
        'placeholder and inserts otherwise; "insert" always inserts; "replace" ' +
        "always replaces the boundary tactic's source span.",
    }),
  ),
  ...focusFields,
});

interface LeanApplyDetails {
  applied: boolean;
  status: string;
  rolledBack?: boolean;
  snippet: string;
  sessionState: LeanSessionState;
}

export function createLeanApplyTool(getHarness: () => LeanHarness) {
  return defineTool({
    name: "lean_apply",
    label: "Lean Apply",
    description:
      "Commit a proof step: re-test the candidate at the focused position, apply the " +
      "exact tested text atomically, verify the containing declaration, and roll back " +
      "on verification failure (per the apply.onVerifyFailure setting). Refuses to run " +
      "when the file or goal changed since the last lean_state/lean_try.",
    promptSnippet:
      "Atomically apply a tested tactic, verify the declaration, roll back on failure",
    promptGuidelines: [
      "Use lean_apply only with candidates that already succeeded in lean_try during this proof state.",
      "After a successful lean_apply, call lean_state again before the next step: the goal and fingerprints have changed.",
      'A `sorry`/`admit` tactic at the focused boundary is replaced by the candidate (filling the scaffold); anything else is inserted alongside. When a prefix candidate succeeds, apply it with require "make_progress" and re-observe with lean_state instead of bundling many steps into one candidate.',
    ],
    executionMode: "sequential",
    parameters,

    async execute(
      _toolCallId,
      params,
      signal,
      onUpdate,
    ): Promise<AgentToolResult<LeanApplyDetails>> {
      onUpdate?.({
        content: [
          { type: "text", text: "Testing candidate before applying..." },
        ],
        details: {
          applied: false,
          status: "testing",
          snippet: params.candidate,
          sessionState: structuredClone(getHarness().state),
        },
      });
      const harness = getHarness();
      const result: LeanApplyResult = await leanApply(
        harness,
        {
          candidate: params.candidate,
          require: params.require,
          mode: params.mode,
          file: stripAt(params.file),
          declaration: params.declaration,
          proofPosition: toProofPosition(params.proofPosition),
        },
        {
          signal,
          withLock: <T>(path: string, fn: () => Promise<T>) =>
            withFileMutationQueue(path, fn),
        },
      );
      const text = truncateText(formatApply(result));
      return {
        content: [{ type: "text", text }],
        details: {
          applied: result.applied,
          status: result.applied
            ? result.verificationStatus
            : (result.trialStatus ?? result.reason),
          rolledBack: result.applied ? undefined : result.rolledBack,
          snippet: params.candidate,
          sessionState: structuredClone(harness.state),
        },
      };
    },

    renderCall(args, theme) {
      return new ToolCallHeader(
        {
          toolName: "Lean Apply",
          mainArg: args.candidate as string | undefined,
          optionArgs: args.declaration
            ? [{ label: "decl", value: String(args.declaration) }]
            : [],
        },
        theme,
      );
    },

    renderResult(result, options, theme) {
      if (options.isPartial) {
        return new Text(
          theme.fg("muted", "Lean Apply: testing, editing, verifying..."),
          0,
          0,
        );
      }
      const { details } = result;
      if (details === undefined || typeof details.applied !== "boolean") {
        const textBlock = result.content.find((c) => c.type === "text");
        const message =
          textBlock?.type === "text" ? textBlock.text : "lean_apply failed";
        return new Text(theme.fg("error", message), 0, 0);
      }
      const statusColor = details.applied
        ? "success"
        : details.rolledBack
          ? "warning"
          : "error";
      return new ToolBody(
        {
          fields: [
            {
              label: "Result",
              value: theme.fg(
                statusColor,
                details.applied
                  ? "applied + verified"
                  : `not applied (${details.status})`,
              ),
              showCollapsed: true,
            },
            { label: "Snippet", value: details.snippet, showCollapsed: true },
            ...(details.rolledBack
              ? [
                  {
                    label: "Rollback",
                    value: "file restored",
                    showCollapsed: true,
                  },
                ]
              : []),
          ],
        },
        options,
        theme,
      );
    },
  });
}
