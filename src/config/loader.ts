import { buildSchemaUrl, ConfigLoader } from "@aliou/pi-utils-settings";
import { DEFAULT_CONFIG } from "./defaults";
import { migrations } from "./migration";
import type { LeanHarnessConfig, ResolvedLeanHarnessConfig } from "./types";

const schemaUrl = buildSchemaUrl("pi-lean-harness", "0.1.0");

export const configLoader = new ConfigLoader<
  LeanHarnessConfig,
  ResolvedLeanHarnessConfig
>("lean-harness", DEFAULT_CONFIG, { migrations, schemaUrl });
