/**
 * lean_state — the current formal situation in one call: proof context,
 * diagnostics, source freshness, and ledger history for this goal.
 */

import { ToolBody, ToolCallHeader } from "@aliou/pi-utils-ui";
import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { LeanHarness } from "../../../src/core";
import { leanState } from "../../../src/core";
import type { LeanSessionState } from "../../../src/proof-state";
import { formatState } from "../format";
import { focusFields } from "../schemas";
import { stripAt, toProofPosition, truncateText } from "./shared";

const parameters = Type.Object({
  ...focusFields,
  include: Type.Optional(
    Type.Array(StringEnum(["goals", "diagnostics", "ledger"] as const), {
      description: "Sections to include (default: all)",
    }),
  ),
});

interface LeanStateDetails {
  declaration: string;
  file: string;
  goalCount: number;
  freshness: string;
  sessionState: LeanSessionState;
}

export function createLeanStateTool(getHarness: () => LeanHarness) {
  return defineTool({
    name: "lean_state",
    label: "Lean State",
    description:
      "Read the current Lean proof situation: goals, hypotheses, diagnostics, source " +
      "freshness, and previous failed attempts for the focused declaration. Providing " +
      "file/declaration sets the shared proof focus used by all lean_* tools.",
    promptSnippet:
      "Read the current Lean proof state, diagnostics, and attempt history",
    promptGuidelines: [
      "Call lean_state before attempting any proof step so the focus, source hash, and goal fingerprint are current.",
      "Use lean_state to change the focused declaration by passing file and declaration.",
    ],
    parameters,

    async execute(
      _toolCallId,
      params,
      signal,
      onUpdate,
    ): Promise<AgentToolResult<LeanStateDetails>> {
      onUpdate?.({
        content: [{ type: "text", text: "Reading proof state..." }],
        details: {
          declaration: "",
          file: "",
          goalCount: 0,
          freshness: "",
          sessionState: structuredClone(getHarness().state),
        },
      });
      const harness = getHarness();
      const result = await leanState(
        harness,
        {
          file: stripAt(params.file),
          declaration: params.declaration,
          proofPosition: toProofPosition(params.proofPosition),
          include: params.include ? [...params.include] : undefined,
        },
        signal,
      );
      const text = truncateText(formatState(result));
      return {
        content: [{ type: "text", text }],
        details: {
          declaration: result.focus.declaration,
          file: result.focus.file,
          goalCount: (
            result.context.goals_after ??
            result.context.goals_before ??
            []
          ).length,
          freshness: result.freshness,
          sessionState: structuredClone(harness.state),
        },
      };
    },

    renderCall(args, theme) {
      return new ToolCallHeader(
        {
          toolName: "Lean State",
          mainArg: args.declaration as string | undefined,
          optionArgs: args.file
            ? [{ label: "file", value: String(args.file) }]
            : [],
        },
        theme,
      );
    },

    renderResult(result, options, theme) {
      if (options.isPartial) {
        return new Text(
          theme.fg("muted", "Lean State: reading proof context..."),
          0,
          0,
        );
      }
      const { details } = result;
      if (!details?.declaration) {
        const textBlock = result.content.find((c) => c.type === "text");
        const message =
          textBlock?.type === "text" ? textBlock.text : "lean_state failed";
        return new Text(theme.fg("error", message), 0, 0);
      }
      return new ToolBody(
        {
          fields: [
            {
              label: "Declaration",
              value: details.declaration,
              showCollapsed: true,
            },
            { label: "File", value: details.file, showCollapsed: true },
            {
              label: "Goals",
              value: String(details.goalCount),
              showCollapsed: true,
            },
            {
              label: "Freshness",
              value: details.freshness,
              showCollapsed: true,
            },
          ],
        },
        options,
        theme,
      );
    },
  });
}
