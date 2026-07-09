import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import type { DevServerProcessHandle } from "../../ports/dev-server-process-port";
import {
  markScriptProcessHandleMissing,
  stopScriptProcessHandle,
  type UpdateScriptState,
} from "./dev-server-runtime-scripts";
import { buildGroupState, type DevServerGroupRuntime } from "./dev-server-state";

const repoConfig: RepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/canonical/repo",
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [{ id: "web", name: "Web", command: "bun run dev" }],
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

const updateScriptState: UpdateScriptState = (runtime, scriptId, update) => {
  const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
  if (!script) {
    throw new Error(`Unknown test script: ${scriptId}`);
  }
  update(script);
};

const requireScript = (runtime: DevServerGroupRuntime, scriptId: string) => {
  const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
  if (!script) {
    throw new Error(`Unknown test script: ${scriptId}`);
  }
  return script;
};

describe("dev-server runtime script helpers", () => {
  test("clears stale process metadata when a process handle is missing", () => {
    const runtime = createRuntime();
    const script = requireScript(runtime, "web");
    script.status = "running";
    script.pid = 401;
    script.startedAt = "2026-05-24T00:00:00.000Z";

    const message = markScriptProcessHandleMissing({
      pid: 401,
      runtime,
      scriptId: "web",
      updateScriptState,
    });

    expect(message).toBe("Dev server process handle missing for pid 401.");
    expect(script).toMatchObject({
      status: "failed",
      pid: null,
      startedAt: null,
      lastError: "Dev server process handle missing for pid 401.",
    });
  });

  test("does not delete a newer process handle after stopping an older handle", async () => {
    const runtime = createRuntime();
    const script = requireScript(runtime, "web");
    const replacementHandle: DevServerProcessHandle = {
      pid: 402,
      stop: () => Effect.succeed(undefined),
    };
    const stoppedHandle: DevServerProcessHandle = {
      pid: 401,
      stop: () =>
        Effect.sync(() => {
          runtime.processes.set("web", replacementHandle);
          script.pid = replacementHandle.pid;
        }),
    };
    runtime.processes.set("web", stoppedHandle);
    script.status = "running";
    script.pid = stoppedHandle.pid;
    script.startedAt = "2026-05-24T00:00:00.000Z";

    await expect(
      Effect.runPromise(
        stopScriptProcessHandle({
          handle: stoppedHandle,
          runtime,
          scriptId: "web",
          updateScriptState,
        }),
      ),
    ).resolves.toBeNull();

    expect(runtime.processes.get("web")).toBe(replacementHandle);
    expect(script).toMatchObject({
      status: "running",
      pid: 402,
      startedAt: "2026-05-24T00:00:00.000Z",
    });
  });
});
