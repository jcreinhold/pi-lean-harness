/**
 * lean_search — definitions, lemmas, and usage examples that help with the
 * current goal or explicit goal text.
 */

import { ToolBody, ToolCallHeader, ToolFooter } from "@aliou/pi-utils-ui";
import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defineTool, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { LeanHarness } from "../../../src/core";
import { leanSearch } from "../../../src/core";
import type { LeanSessionState } from "../../../src/proof-state";
import { formatSearch } from "../format";
import { truncateText } from "./shared";

const parameters = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        'Explicit goal/type text or a natural-language description. Required when `for` is "text". ' +
        "Omit to search for the focused goal.",
    }),
  ),
  names: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Fully-qualified declaration names to inspect directly (max 8). Returns exact " +
        "statements, docstrings, and attributes instead of a goal-ranked search — use " +
        "to verify a lemma exists and read its exact type before rewriting with it.",
    }),
  ),
  for: Type.Optional(
    StringEnum(["current_goal", "text"] as const, {
      description:
        'Search the focused goal (default) or explicit `query` text ("text")',
    }),
  ),
  includeExamples: Type.Optional(
    Type.Boolean({
      description: "Include nearby usage examples from the reference index",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max candidates (default 8, backend cap 20)" }),
  ),
});

interface LeanSearchDetails {
  candidateCount: number;
  topCandidates: string[];
  sessionState: LeanSessionState;
}

export function createLeanSearchTool(getHarness: () => LeanHarness) {
  return defineTool({
    name: "lean_search",
    label: "Lean Search",
    description:
      "Find Lean declarations that help with the focused goal (or explicit goal text): " +
      "ranked candidates with exact types, match reasons, suggested tactics, docstrings, " +
      "and optionally real usage examples.",
    promptSnippet:
      "Search for Lean lemmas/definitions relevant to the current goal",
    promptGuidelines: [
      "Use lean_search when stuck on a goal before inventing lemma names; it returns exact types and suggested tactics.",
      "Before rewriting with a lemma you have not verified, pass its fully-qualified name via `names` to read its exact statement — never guess simps-projection or lemma names.",
    ],
    parameters,

    async execute(
      _toolCallId,
      params,
      signal,
      onUpdate,
    ): Promise<AgentToolResult<LeanSearchDetails>> {
      onUpdate?.({
        content: [{ type: "text", text: "Searching declarations..." }],
        details: {
          candidateCount: 0,
          topCandidates: [],
          sessionState: structuredClone(getHarness().state),
        },
      });
      const harness = getHarness();
      const result = await leanSearch(
        harness,
        {
          query: params.query,
          for: params.for,
          includeExamples: params.includeExamples,
          limit: params.limit,
        },
        signal,
      );
      const text = truncateText(formatSearch(result));
      return {
        content: [{ type: "text", text }],
        details: {
          candidateCount: result.candidates.length,
          topCandidates: result.candidates.slice(0, 5).map((c) => c.name),
          sessionState: structuredClone(harness.state),
        },
      };
    },

    renderCall(args, theme) {
      return new ToolCallHeader(
        {
          toolName: "Lean Search",
          mainArg: (args.query as string | undefined) ?? "current goal",
        },
        theme,
      );
    },

    renderResult(result, options, theme) {
      if (options.isPartial) {
        return new Text(
          theme.fg("muted", "Lean Search: querying backend..."),
          0,
          0,
        );
      }
      const { details } = result;
      if (!details?.topCandidates) {
        const textBlock = result.content.find((c) => c.type === "text");
        const message =
          textBlock?.type === "text" ? textBlock.text : "lean_search failed";
        return new Text(theme.fg("error", message), 0, 0);
      }
      const fields = details.topCandidates.map((name, i) => ({
        label: `#${i + 1}`,
        value: name,
        showCollapsed: i < 3,
      }));
      const footerItems = [];
      if (!options.expanded && details.candidateCount > 3) {
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
