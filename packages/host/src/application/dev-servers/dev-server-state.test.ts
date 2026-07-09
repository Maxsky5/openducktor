import type { RepoConfig } from "@openducktor/contracts";
import {
  buildGroupState,
  type DevServerGroupRuntime,
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
  terminalRunGenerationByScriptId: new Map(),
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
    runtime.terminalRunGenerationByScriptId.set("web", 1);
    runtime.terminalRunGenerationByScriptId.set("api", 2);

    syncRuntimeTerminalBufferByteCounts(runtime);

    expect(runtime.terminalBufferedBytesByScriptId.has("api")).toBe(false);
    expect(runtime.terminalNextSequenceByScriptId.has("api")).toBe(false);
    expect(runtime.terminalRunGenerationByScriptId.has("api")).toBe(false);
    expect(runtime.terminalNextSequenceByScriptId.has("removed-sequence-only")).toBe(false);
    expect(runtime.terminalBufferedBytesByScriptId.get("web")).toBe(12);
    expect(runtime.terminalNextSequenceByScriptId.get("web")).toBe(3);
    expect(runtime.terminalRunGenerationByScriptId.get("web")).toBe(1);
  });
});
