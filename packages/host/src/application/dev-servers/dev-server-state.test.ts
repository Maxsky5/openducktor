import type { RepoConfig } from "@openducktor/contracts";
import {
  buildGroupState,
  type DevServerGroupRuntime,
  startTerminalRun,
  syncGroupState,
  syncRuntimeTerminalBufferByteCounts,
} from "./dev-server-state";

const repoConfig: RepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/canonical/repo",
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [
    { id: "web", name: "Web", command: "bun run dev" },
    { id: "api", name: "API", command: "bun run api" },
  ],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
};

const createRuntime = (): DevServerGroupRuntime => ({
  processes: new Map(),
  state: buildGroupState(repoConfig, "task-1", "/worktrees/task-1", "2026-05-24T00:00:00.000Z"),
  terminalBufferedBytesByScriptId: new Map(),
  terminalNextSequenceByScriptId: new Map(),
  terminalRunGeneration: 0,
});

describe("dev-server state helpers", () => {
  test("prunes terminal runtime accounting for inactive scripts", () => {
    const runtime = createRuntime();
    runtime.state.scripts = runtime.state.scripts.filter((script) => script.scriptId === "web");
    runtime.terminalBufferedBytesByScriptId.set("web", 12);
    runtime.terminalBufferedBytesByScriptId.set("api", 24);
    runtime.terminalNextSequenceByScriptId.set("web", 3);
    runtime.terminalNextSequenceByScriptId.set("api", 9);
    runtime.terminalNextSequenceByScriptId.set("removed-sequence-only", 17);
    runtime.terminalRunGeneration = 2;

    syncRuntimeTerminalBufferByteCounts(runtime);

    expect(runtime.terminalBufferedBytesByScriptId.has("api")).toBe(false);
    expect(runtime.terminalNextSequenceByScriptId.has("api")).toBe(false);
    expect(runtime.terminalNextSequenceByScriptId.has("removed-sequence-only")).toBe(false);
    expect(runtime.terminalBufferedBytesByScriptId.get("web")).toBe(12);
    expect(runtime.terminalNextSequenceByScriptId.get("web")).toBe(3);
    expect(runtime.terminalRunGeneration).toBe(2);
  });

  test("does not reuse a run identity after a script is removed and re-added", () => {
    const runtime = createRuntime();
    const firstScript = runtime.state.scripts[0];
    if (!firstScript) {
      throw new Error("Expected configured web script.");
    }
    startTerminalRun(runtime, firstScript, "host-1");
    const firstRunId = firstScript.runId;

    syncGroupState(runtime.state, { ...repoConfig, devServers: [] }, "task-1", "/worktrees/task-1");
    syncRuntimeTerminalBufferByteCounts(runtime);
    syncGroupState(runtime.state, repoConfig, "task-1", "/worktrees/task-1");
    const readdedScript = runtime.state.scripts[0];
    if (!readdedScript) {
      throw new Error("Expected re-added web script.");
    }
    startTerminalRun(runtime, readdedScript, "host-1");

    expect(readdedScript.runId).not.toBe(firstRunId);
  });
});
