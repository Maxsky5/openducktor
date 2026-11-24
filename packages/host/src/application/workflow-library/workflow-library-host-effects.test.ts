import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { Effect } from "effect";
import { syncWorkspace } from "../tasks/sync/task-sync-service.test-support";
import { createRunningTaskSessionsReader } from "./workflow-library-host-effects";

const ref = (externalSessionId: string) => ({
  repoPath: "/repo",
  runtimeKind: "claude" as const,
  workingDirectory: "/repo",
  externalSessionId,
});

const snapshot = (
  externalSessionId: string,
  activity: AgentSessionLiveSnapshot["activity"],
): AgentSessionLiveSnapshot => ({
  ref: ref(externalSessionId),
  activity,
  title: externalSessionId,
  startedAt: "2026-11-08T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

describe("createRunningTaskSessionsReader", () => {
  test("lists the task sessions that work, not the idle ones that the host still holds", async () => {
    const read = createRunningTaskSessionsReader({
      live: {
        list: () =>
          Effect.succeed([snapshot("idle-qa", "idle"), snapshot("busy-build", "running")]),
      },
      readSessionRootRefs: () =>
        Effect.succeed(
          (["idle-qa", "busy-build"] as const).map((id) => ({
            ...ref(id),
            sessionScope: {
              kind: "workflow" as const,
              workspaceId: "workspace-1",
              taskId: "task-1",
              role: id === "idle-qa" ? "qa" : "build",
            },
          })),
        ),
      settings: {
        getWorkspaceCatalog: () =>
          Effect.succeed({
            catalogRevision: 0,
            openWorkspaces: [syncWorkspace("/repo", "workspace-1")],
            closedWorkspaces: [],
            incompleteRemovals: [],
          }),
      },
    });

    expect(await Effect.runPromise(read())).toEqual([
      { workspaceId: "workspace-1", taskId: "task-1", role: "build" },
    ]);
  });
});
