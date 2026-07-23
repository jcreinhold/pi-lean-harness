import {
  registerSettingsCommand,
  type SettingsSection,
} from "@aliou/pi-utils-settings";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import {
  configLoader,
  type LeanHarnessConfig,
  type ResolvedLeanHarnessConfig,
} from "../../../../src/config";
import {
  createConfigUpdatedPayload,
  LEAN_CONFIG_UPDATED_EVENT,
  type LeanFeatureId,
} from "../../../../src/events";

export function registerLeanHarnessSettings(
  pi: ExtensionAPI,
  options: { getLoadedFeatures: () => Set<LeanFeatureId> },
): void {
  registerSettingsCommand<LeanHarnessConfig, ResolvedLeanHarnessConfig>(pi, {
    commandName: "lean-harness:settings",
    commandDescription:
      "Configure the Lean harness (server, apply policy, tools)",
    title: "Lean Harness Settings",
    configStore: configLoader,
    buildSections: (tabConfig, resolved): SettingsSection[] => [
      {
        label: "Apply",
        items: [
          {
            id: "apply.onVerifyFailure",
            label: "On verification failure",
            description:
              "After lean_apply edits a file, lean_verify runs. rollback restores the " +
              "original bytes on failure; keep leaves the unverified edit in place.",
            currentValue:
              tabConfig?.apply?.onVerifyFailure ??
              resolved.apply.onVerifyFailure,
            values: ["rollback", "keep"],
          },
        ],
      },
      {
        label: "Features",
        items: [
          featureRow(
            "tools.enabled",
            "Lean tools",
            "The five lean_* tools backed by lean-host-mcp",
            tabConfig?.tools?.enabled ?? resolved.tools.enabled,
            options.getLoadedFeatures().has("lean-tools"),
          ),
        ],
      },
      {
        label: "Server (config file only)",
        items: [
          {
            id: "server.url",
            label: "Server URL",
            description:
              "Set in the config file: leanHarness.server.url. " +
              "Start the backend with: lean-host-mcp serve --bind 127.0.0.1:8765",
            currentValue: tabConfig?.server?.url ?? resolved.server.url,
            values: [],
          },
          {
            id: "server.requestTimeoutMs",
            label: "Request timeout (ms)",
            description:
              "Set in the config file: leanHarness.server.requestTimeoutMs.",
            currentValue: String(
              tabConfig?.server?.requestTimeoutMs ??
                resolved.server.requestTimeoutMs,
            ),
            values: [],
          },
        ],
      },
    ],
    onSettingChange: (id, newValue, config): LeanHarnessConfig | null => {
      const updated = structuredClone(config);
      switch (id) {
        case "apply.onVerifyFailure":
          if (newValue !== "rollback" && newValue !== "keep") return null;
          updated.apply = { ...updated.apply, onVerifyFailure: newValue };
          return updated;
        case "tools.enabled":
          updated.tools = { ...updated.tools, enabled: newValue === "enabled" };
          return updated;
        default:
          return null;
      }
    },
    onSave: async () => {
      pi.events.emit(
        LEAN_CONFIG_UPDATED_EVENT,
        createConfigUpdatedPayload(configLoader.getConfig()),
      );
    },
  });
}

function featureRow(
  id: string,
  label: string,
  description: string,
  configValue: boolean,
  isLoaded: boolean,
): SettingItem {
  if (isLoaded) {
    return {
      id,
      label,
      description,
      currentValue: configValue ? "enabled" : "disabled",
      values: ["enabled", "disabled"],
    };
  }
  return {
    id,
    label,
    description: `${description} (Not loaded by Pi)`,
    currentValue: "unavailable",
    values: [],
  };
}
