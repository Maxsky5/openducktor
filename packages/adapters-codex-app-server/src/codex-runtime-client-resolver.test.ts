import { expect, mock, test } from "bun:test";
import { makeRuntimeSummary, testManagedMcpServer } from "./codex-app-server-adapter.test-harness";
import { CodexAppServerAdapter } from "./index";

test("reports workspace runtime failures without session identity", async () => {
  const transportFactory = mock(() => {
    throw new Error("transportFactory should not be called");
  });
  const adapter = new CodexAppServerAdapter({
    resolveManagedMcpServer: testManagedMcpServer,
    runtime: {
      ...makeRuntimeSummary("runtime-wrong-route"),
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:43123" },
    },
    transportFactory,
  });

  await expect(
    adapter.loadRuntimeCatalog({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
    }),
  ).rejects.toThrow(
    "runtime 'runtime-wrong-route' is missing required route contract 'stdio' for repo '/repo' while attempting to load runtime catalog",
  );
  expect(transportFactory).toHaveBeenCalledTimes(0);
});

test("validates operation working directories before creating a transport", async () => {
  const transportFactory = mock(() => {
    throw new Error("transportFactory should not be called");
  });
  const adapter = new CodexAppServerAdapter({
    resolveManagedMcpServer: testManagedMcpServer,
    runtime: makeRuntimeSummary("runtime-live"),
    transportFactory,
  });

  await expect(
    adapter.searchFiles({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: " ",
      query: "policy",
    }),
  ).rejects.toThrow("Session workingDirectory is required to search files.");
  expect(transportFactory).toHaveBeenCalledTimes(0);
});
