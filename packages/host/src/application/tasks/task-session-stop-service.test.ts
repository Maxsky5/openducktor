import {
  type AgentSessionRecord,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeSessionTarget } from "../../ports/runtime-registry-port";
import { createTaskSessionStopService } from "./task-session-stop-service";

type StopServiceDependencies = Parameters<typeof createTaskSessionStopService>[0];

const createGitPort = (): StopServiceDependencies["gitPort"] => ({
  canonicalizePath: (path) => Effect.succeed(path === "/repo" ? "/canonical/repo" : path),
  isGitRepository: (path) => Effect.succeed(path === "/canonical/repo"),
});

const createRuntimeDefinitionsService = () => ({
  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return Object.values(RUNTIME_DESCRIPTORS_BY_KIND);
  },
});

const createTaskStore = (
  sessionOverrides: Partial<AgentSessionRecord> = {},
  extraAgentSessions: AgentSessionRecord[] = [],
): StopServiceDependencies["taskReader"] => ({
  getTaskMetadata: () =>
    Effect.succeed({
      spec: { markdown: "" },
      plan: { markdown: "" },
      agentSessions: [
        {
          externalSessionId: "external-session-1",
          role: "build" as const,
          startedAt: "2026-05-10T10:00:00.000Z",
          runtimeKind: "opencode" as const,
          workingDirectory: "/canonical/repo/worktree",
          selectedModel: null,
          ...sessionOverrides,
        },
        ...extraAgentSessions,
      ],
    }),
});

const createSessionStopper = (
  stopSession: StopServiceDependencies["runtimeRegistry"]["stopSession"],
): StopServiceDependencies["runtimeRegistry"] => ({ stopSession });

const recordingStopper = (calls: RuntimeSessionTarget[]) =>
  createSessionStopper((input) =>
    Effect.sync(() => {
      calls.push(input);
    }),
  );

describe("createTaskSessionStopService agentSessionStop", () => {
  test("stops persisted agent sessions through the shared runtime of their kind", async () => {
    const calls: RuntimeSessionTarget[] = [];
    const service = createTaskSessionStopService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: recordingStopper(calls),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        runtimeKind: "opencode",
        externalSessionId: "external-session-1",
        workingDirectory: "/canonical/repo/worktree",
      },
    ]);
  });

  test("stops the exact persisted session when external ids collide", async () => {
    const calls: RuntimeSessionTarget[] = [];
    const service = createTaskSessionStopService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: recordingStopper(calls),
      taskReader: createTaskStore(
        {
          externalSessionId: "shared-session",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/old-worktree",
        },
        [
          {
            externalSessionId: "shared-session",
            role: "build",
            startedAt: "2026-05-10T11:00:00.000Z",
            runtimeKind: "opencode",
            workingDirectory: "/canonical/repo/target-worktree",
            selectedModel: null,
          },
        ],
      ),
    });

    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "shared-session",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/target-worktree",
        }),
      ),
    ).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      {
        runtimeKind: "opencode",
        externalSessionId: "shared-session",
        workingDirectory: "/canonical/repo/target-worktree",
      },
    ]);
  });

  test("rejects agent session stop when persisted session identity mismatches the request", async () => {
    const calls: RuntimeSessionTarget[] = [];
    const service = createTaskSessionStopService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: recordingStopper(calls),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "codex",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Agent session external-session-1 (codex, /canonical/repo/worktree)");
    expect(calls).toEqual([]);
  });

  test("propagates runtime registry stop failures", async () => {
    const service = createTaskSessionStopService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createSessionStopper(() =>
        Effect.fail(
          new HostOperationError({
            operation: "runtimeRegistry.stopSession",
            message: "runtime stop failed",
          }),
        ),
      ),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).rejects.toThrow("runtime stop failed");
  });
});
