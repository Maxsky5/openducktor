import { Effect } from "effect";
import type { RepoConfig } from "@openducktor/contracts";
import {
  buildGroupState,
  type DevServerGroupRuntime,
  syncGroupState,
  syncRuntimeTerminalSources,
} from "./dev-server-state";

const repoConfig: RepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/canonical/repo",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { preStart: [], postComplete: [] },
  devServers: [
    { id: "web", name: "Web", command: "bun run dev" },
    { id: "api", name: "API", command: "bun run api" },
  ],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  agentStudioState: { openTaskIds: [] },
};

const updatedRepoConfig: RepoConfig = {
  ...repoConfig,
  devServers: [{ id: "web", name: "Web next", command: "bun run dev:next" }],
};

const createRuntime = (): DevServerGroupRuntime => ({
  processes: new Map(),
  unresolvedStops: new Set(),
  state: buildGroupState(
    repoConfig,
    { kind: "task", taskId: "task-1" },
    "/worktrees/task-1",
    "2026-05-24T00:00:00.000Z",
  ),
  terminalOutputs: new Map(),
});

describe("dev-server state helpers", () => {
  test("releases removed script output without releasing a retained run", () => {
    const runtime = createRuntime();
    runtime.state.scripts = runtime.state.scripts.filter((script) => script.scriptId === "web");
    const released: string[] = [];
    for (const scriptId of ["web", "api"])
      runtime.terminalOutputs.set(scriptId, {
        terminalId: scriptId,
        write: () => {},
        activate: () => Effect.void,
        exit: () => {},
        release: () => {
          released.push(scriptId);
        },
      });
    syncRuntimeTerminalSources(runtime);
    expect(released).toEqual(["api"]);
    expect([...runtime.terminalOutputs.keys()]).toEqual(["web"]);
  });

  test("keeps the started command when the configured command changes", () => {
    const runtime = createRuntime();
    const firstScript = runtime.state.scripts[0];
    if (!firstScript) {
      throw new Error("Expected configured web script.");
    }
    firstScript.startedCommand = "bun run dev";

    syncGroupState(
      runtime.state,
      updatedRepoConfig,
      runtime.state.owner,
      "/worktrees/task-1",
      runtime.unresolvedStops,
    );

    expect(runtime.state.scripts[0]).toMatchObject({
      command: "bun run dev:next",
      name: "Web next",
      startedCommand: "bun run dev",
    });
  });

  test("leaves the started command unset for scripts without a run", () => {
    const runtime = createRuntime();

    syncGroupState(
      runtime.state,
      updatedRepoConfig,
      runtime.state.owner,
      "/worktrees/task-1",
      runtime.unresolvedStops,
    );

    expect(runtime.state.scripts[0]).toMatchObject({
      command: "bun run dev:next",
      name: "Web next",
      startedCommand: null,
    });
  });
});
