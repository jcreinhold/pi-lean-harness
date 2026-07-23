/**
 * /lean-debug — human-only inspection of the harness: connection status,
 * raw backend tools, current focus, and the proof ledger.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getActiveHarness } from "../../../src/core";

export function registerLeanDebugCommand(pi: ExtensionAPI): void {
  pi.registerCommand("lean-debug", {
    description:
      "Inspect the Lean harness: /lean-debug [status|raw-tools|focus|ledger]",
    handler: async (args, ctx) => {
      const harness = getActiveHarness();
      if (!harness) {
        ctx.ui.notify(
          "Lean harness is not active (lean-tools disabled or no session yet).",
          "warning",
        );
        return;
      }

      const subcommand = (args ?? "").trim() || "status";
      try {
        switch (subcommand) {
          case "status": {
            const caps = await harness.ensureReady();
            const config = harness.getConfig();
            ctx.ui.notify(
              [
                "lean-harness status",
                `  server: ${config.server.url} (connected)`,
                `  project: ${caps.projectRoot ?? "unknown"}`,
                `  toolchain: ${caps.toolchain ?? "unknown"}`,
                `  backend tools: ${caps.tools.join(", ")}`,
                `  focus: ${formatFocus(harness)}`,
              ].join("\n"),
              "info",
            );
            break;
          }
          case "raw-tools": {
            const tools = await harness.client.listToolNames();
            ctx.ui.notify(
              `lean-host-mcp tools:\n${tools.map((t) => `  ${t}`).join("\n")}`,
              "info",
            );
            break;
          }
          case "focus": {
            ctx.ui.notify(formatFocus(harness), "info");
            break;
          }
          case "ledger": {
            const state = harness.state;
            const recent = [...state.failedAttempts, ...state.successfulSteps]
              .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
              .slice(-10);
            ctx.ui.notify(
              [
                `ledger: ${state.successfulSteps.length} successful, ${state.failedAttempts.length} failed`,
                `last verification: ${state.lastVerification ? `${state.lastVerification.declaration} -> ${state.lastVerification.status}` : "none"}`,
                ...recent.map(
                  (a) =>
                    `  [${a.outcome}] ${a.snippet}${a.message ? ` — ${a.message}` : ""}`,
                ),
              ].join("\n"),
              "info",
            );
            break;
          }
          default:
            ctx.ui.notify(
              `Unknown /lean-debug subcommand "${subcommand}". Use status, raw-tools, focus, or ledger.`,
              "warning",
            );
        }
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });
}

function formatFocus(
  harness: NonNullable<ReturnType<typeof getActiveHarness>>,
): string {
  const focus = harness.state.focus;
  if (!focus) return "no proof focus set";
  return `${focus.declaration} @ ${focus.file} (position: ${JSON.stringify(focus.proofPosition)})`;
}
