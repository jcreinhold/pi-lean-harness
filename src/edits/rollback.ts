/**
 * Rollback: restore a file to its exact pre-edit bytes after a failed
 * post-edit verification.
 */

import { writeFile } from "node:fs/promises";
import type { PreparedEdit } from "./transaction";

export class RollbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollbackError";
  }
}

/**
 * Restore the original content captured in the prepared edit. Byte-exact:
 * the file is indistinguishable from its pre-transaction state.
 */
export async function rollbackEdit(edit: PreparedEdit): Promise<void> {
  try {
    await writeFile(edit.path, edit.originalContent, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RollbackError(
      `Failed to roll back ${edit.path}: ${detail}. ` +
        "The file may still contain the unverified edit; inspect it manually.",
    );
  }
}
