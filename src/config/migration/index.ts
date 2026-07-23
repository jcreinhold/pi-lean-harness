import type { Migration } from "@aliou/pi-utils-settings";
import type { LeanHarnessConfig } from "../types";

const migrationMessages: string[] = [];

/** Drain and return any warning messages accumulated during config migration. */
export function drainMigrationMessages(): string[] {
  return migrationMessages.splice(0);
}

export const migrations: Migration<LeanHarnessConfig>[] = [
  // No migrations yet. Add named, idempotent migrations here when the
  // config shape changes.
];
