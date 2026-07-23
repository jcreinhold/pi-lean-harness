/**
 * Main extension: owns config loading, the settings command, feature
 * discovery via the event bus, and the human-only /lean-debug command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configLoader, drainMigrationMessages } from "../../src/config";
import {
  createConfigUpdatedPayload,
  createFeatureRequestPayload,
  LEAN_CONFIG_UPDATED_EVENT,
  LEAN_FEATURE_REGISTER_EVENT,
  LEAN_FEATURE_REQUEST_EVENT,
  type LeanFeatureId,
} from "../../src/events";
import { registerLeanDebugCommand } from "./commands/debug";
import { registerLeanHarnessSettings } from "./commands/settings";

export default async function leanHarnessExtension(pi: ExtensionAPI) {
  await configLoader.load();

  const loadedFeatures = new Set<LeanFeatureId>();

  pi.events.on(LEAN_FEATURE_REGISTER_EVENT, (data: unknown) => {
    const payload = data as { feature: { id: LeanFeatureId } };
    loadedFeatures.add(payload.feature.id);
  });

  pi.on("session_start", (_event, ctx) => {
    loadedFeatures.clear();
    pi.events.emit(LEAN_FEATURE_REQUEST_EVENT, createFeatureRequestPayload());
    pi.events.emit(
      LEAN_CONFIG_UPDATED_EVENT,
      createConfigUpdatedPayload(configLoader.getConfig()),
    );

    const messages = drainMigrationMessages();
    if (messages.length > 0) {
      ctx.ui.notify(
        [
          "lean-harness: config warnings:",
          ...messages.map((msg) => `- ${msg}`),
        ].join("\n"),
        "warning",
      );
    }
  });

  registerLeanHarnessSettings(pi, { getLoadedFeatures: () => loadedFeatures });
  registerLeanDebugCommand(pi);
}
