import { afterEach, describe, expect, it } from "vitest";
import { checkCapabilities } from "../src/backend/capabilities";
import { LeanBackendClient, LeanBackendError } from "../src/backend/mcp-client";
import {
  type FakeBackend,
  ok,
  PROJECT_STATUS,
  startFakeBackend,
} from "./fake-backend";

const ALL_TOOLS = [
  "lean_context",
  "lean_trial",
  "lean_verify",
  "lean_lookup",
  "lean_status",
];

let backend: FakeBackend | null = null;

afterEach(async () => {
  await backend?.close();
  backend = null;
});

async function startWith(tools: string[]): Promise<LeanBackendClient> {
  const handlers = Object.fromEntries(
    tools.map((name) => [name, () => ok(PROJECT_STATUS)]),
  );
  backend = await startFakeBackend({ handlers });
  return new LeanBackendClient({ url: backend.url, requestTimeoutMs: 5000 });
}

describe("checkCapabilities", () => {
  it("passes when all five tools are advertised and reports identity", async () => {
    const client = await startWith(ALL_TOOLS);
    const report = await checkCapabilities(client);
    expect(report.tools.sort()).toEqual([...ALL_TOOLS].sort());
    expect(report.projectRoot).toBe("/fake/project");
    expect(report.toolchain).toBe("leanprover/lean4:v4.30.0");
    expect(report.leanMaxMemoryKib).toBe(18874368);
    await client.close();
  });

  it("leaves the heap ceiling unset when the broker block omits it", async () => {
    const handlers = Object.fromEntries(
      ALL_TOOLS.map((name) => [
        name,
        () => ok({ ...PROJECT_STATUS, broker: {} }),
      ]),
    );
    backend = await startFakeBackend({ handlers });
    const client = new LeanBackendClient({
      url: backend.url,
      requestTimeoutMs: 5000,
    });
    const report = await checkCapabilities(client);
    expect(report.leanMaxMemoryKib).toBeUndefined();
    await client.close();
  });

  it("fails clearly when a required tool is missing", async () => {
    const client = await startWith(ALL_TOOLS.filter((t) => t !== "lean_trial"));
    await expect(checkCapabilities(client)).rejects.toThrow(LeanBackendError);
    await expect(checkCapabilities(client)).rejects.toThrow(/lean_trial/);
    await client.close();
  });

  it("client surfaces a helpful error for an unreachable server", async () => {
    const client = new LeanBackendClient({
      url: "http://127.0.0.1:1/mcp",
      requestTimeoutMs: 1000,
    });
    await expect(client.connect()).rejects.toThrow(
      /lean-host-mcp serve --bind/,
    );
  });
});
