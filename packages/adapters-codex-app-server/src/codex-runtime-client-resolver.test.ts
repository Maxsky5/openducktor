import { expect, mock, test } from "bun:test";
import { makeRuntimeSummary } from "./codex-app-server-adapter.test-harness";
import { CodexAppServerAdapter } from "./index";

test("reports workspace runtime failures without session identity", async () => {
  const requireRepoRuntime = mock(async () => ({
    ...makeRuntimeSummary("runtime-wrong-route"),
    runtimeRoute: { type: "local_http" as const, endpoint: "http://127.0.0.1:43123" },
  }));
  const transportFactory = mock(() => {
    throw new Error("transportFactory should not be called");
  });
  const adapter = new CodexAppServerAdapter({
    repoRuntimeResolver: { requireRepoRuntime },
    transportFactory,
  });

  await expect(
    adapter.listAvailableModels({ repoPath: "/repo", runtimeKind: "codex" }),
  ).rejects.toThrow(
    "runtime 'runtime-wrong-route' is missing required route contract 'stdio' for repo '/repo' while attempting to list available models",
  );
  expect(requireRepoRuntime).toHaveBeenCalledTimes(1);
  expect(transportFactory).toHaveBeenCalledTimes(0);
});

test("validates operation working directories before resolving the runtime", async () => {
  const requireRepoRuntime = mock(async () => makeRuntimeSummary("runtime-live"));
  const transportFactory = mock(() => {
    throw new Error("transportFactory should not be called");
  });
  const adapter = new CodexAppServerAdapter({
    repoRuntimeResolver: { requireRepoRuntime },
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
  expect(requireRepoRuntime).toHaveBeenCalledTimes(0);
  expect(transportFactory).toHaveBeenCalledTimes(0);
});
