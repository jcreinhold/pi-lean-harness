/**
 * lean-tools sub-extension: owns the LeanHarness lifecycle and registers the
 * five façade tools. Registers with the main extension via the event bus and
 * rebuilds proof state from the session branch on session_start.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configLoader } from "../../src/config";
import { LeanHarness, setActiveHarness } from "../../src/core";
import {
  createFeatureRegisterPayload,
  LEAN_CONFIG_UPDATED_EVENT,
  LEAN_FEATURE_REGISTER_EVENT,
  LEAN_FEATURE_REQUEST_EVENT,
  type LeanConfigUpdatedPayload,
} from "../../src/events";
import { rebuildStateFromBranch } from "../../src/proof-state";
import { createLeanApplyTool } from "./tools/apply";
import { createLeanSearchTool } from "./tools/search";
import { createLeanStateTool } from "./tools/state";
import { createLeanTryTool } from "./tools/try";
import { createLeanVerifyTool } from "./tools/verify";

export default async function leanToolsExtension(pi: ExtensionAPI) {
  await configLoader.load();

  let enabled = configLoader.getConfig().tools.enabled;
  let harness: LeanHarness | null = null;

  function requireHarness(): LeanHarness {
    if (!enabled || !harness) {
      throw new Error(
        "Lean tools are not active. Enable them in /lean-harness:settings and start " +
          "lean-host-mcp (lean-host-mcp serve --bind 127.0.0.1:8765).",
      );
    }
    return harness;
  }

  function registerFeature(): void {
    pi.events.emit(
      LEAN_FEATURE_REGISTER_EVENT,
      createFeatureRegisterPayload("lean-tools"),
    );
  }

  registerFeature();
  pi.events.on(LEAN_FEATURE_REQUEST_EVENT, registerFeature);

  pi.events.on(LEAN_CONFIG_UPDATED_EVENT, (data: unknown) => {
    const config = (data as LeanConfigUpdatedPayload).config;
    enabled = config.tools.enabled;
    harness?.setConfig(config);
    if (!enabled) setActiveHarness(null);
  });

  pi.on("session_start", (_event, ctx) => {
    if (!enabled) {
      harness = null;
      setActiveHarness(null);
      return;
    }
    // Rebuild proof state from the active branch so fork/compact/resume keep
    // the focus and ledger of the branch the user is actually on.
    const state = rebuildStateFromBranch(
      ctx.sessionManager.getBranch() as unknown as Parameters<
        typeof rebuildStateFromBranch
      >[0],
    );
    harness = new LeanHarness(configLoader.getConfig(), state);
    setActiveHarness(harness);
  });

  const getHarness = () => requireHarness();
  pi.registerTool(createLeanStateTool(getHarness));
  pi.registerTool(createLeanSearchTool(getHarness));
  pi.registerTool(createLeanTryTool(getHarness));
  pi.registerTool(createLeanApplyTool(getHarness));
  pi.registerTool(createLeanVerifyTool(getHarness));
}
