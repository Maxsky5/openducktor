import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  NotificationOccurrence,
  WorkspaceSession,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { readCachedAgentSessionAssociation } from "@/state/queries/agent-session-association";
import {
  workspaceSessionListQueryOptions,
  workspaceSessionQueryKeys,
  updateWorkspaceSessionQueries,
} from "@/state/queries/workspace-sessions";
import { createNotificationTaskObserver } from "./notification-task-observer";
import { createNotificationWorkspaceObserver } from "./notification-workspace-observer";
import { navigateToNotificationTarget } from "./notification-navigation-logic";

const ref = {
  repoPath: "/inactive",
  runtimeKind: "codex",
  workingDirectory: "/inactive/worktree",
  externalSessionId: "native",
} as const;
const record = (): WorkspaceSession => ({
  id: "chat",
  runtimeKind: ref.runtimeKind,
  externalSessionId: ref.externalSessionId,
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: ref.workingDirectory,
    branchName: "feature/chat",
    worktreeState: "present",
  },
  selectedModel: null,
  roleSnapshot: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});
const snapshot = (overrides: Partial<AgentSessionLiveSnapshot> = {}): AgentSessionLiveSnapshot => ({
  ref,
  activity: "running",
  executionEpisodeId: "episode-1",
  title: "Chat",
  startedAt: "2026-09-12T12:00:00Z",
  pendingApprovals: [],
  pendingQuestions: [],
  pendingAsyncQuestions: [],
  contextUsage: null,
  ...overrides,
});

describe("Workspace Session notifications", () => {
  test.each(
    (["permission", "question", "idle", "error"] as const).flatMap((kind) =>
      (["cold", "loaded"] as const).map((phase) => [kind, phase] as const),
    ),
  )("keeps an inactive workspace %s event when record state is %s", async (kind, phase) => {
    const client = new QueryClient();
    const baseline = Promise.withResolvers<WorkspaceSession[]>();
    const published: NotificationOccurrence[] = [];
    const failures: unknown[] = [];
    let receive!: (event: AgentSessionLiveEnvelope) => void;
    let stopped = 0;
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => [],
      loadSessionRecords: async () => ({}),
      resolveSessionAssociation: (target) => readCachedAgentSessionAssociation(client, target),
      publish: (event) => published.push(event),
      onFailure: (error) => failures.push(error),
    });
    const observer = createNotificationWorkspaceObserver({
      taskObserver,
      publish: (event) => published.push(event),
      onFailure: (error) => failures.push(error),
      observe: async (_input, listener) => {
        receive = listener;
        listener({
          type: "snapshot",
          repoPath: ref.repoPath,
          sessions: [snapshot()],
          isConnectionSnapshot: true,
        });
        return () => {
          stopped++;
        };
      },
      sessionRecords: {
        load: async () => {
          await client.fetchQuery(
            workspaceSessionListQueryOptions("inactive", false, {
              workspaceSessionListActive: () => baseline.promise,
              workspaceSessionListArchived: async () => [],
            }),
          );
        },
        resolve: (target) => readCachedAgentSessionAssociation(client, target, "inactive"),
        subscribe: (listener) =>
          client.getQueryCache().subscribe((event) => {
            if (event.type === "updated" && event.action.type === "success") listener();
          }),
      },
    });
    try {
      const syncing = observer.syncWorkspaces([
        { repoPath: ref.repoPath, repositoryLabel: "Inactive" },
      ]);
      if (phase === "loaded") {
        baseline.resolve([]);
        await syncing;
      } else {
        updateWorkspaceSessionQueries(client, "inactive", {
          ...record(),
          manualTitle: "Current title",
        });
      }
      const event: AgentSessionLiveEnvelope =
        kind === "permission" || kind === "question"
          ? {
              type: "session_upsert",
              session: snapshot({
                activity: kind === "permission" ? "waiting_for_permission" : "waiting_for_question",
                pendingApprovals:
                  kind === "permission"
                    ? [
                        {
                          requestId: "permission",
                          requestType: "command_execution",
                          title: "Run",
                        },
                      ]
                    : [],
                pendingQuestions:
                  kind === "question" ? [{ requestId: "question", questions: [] }] : [],
              }),
            }
          : {
              type: "transcript_event",
              event: {
                type: kind === "error" ? "session_error" : "session_finished",
                externalSessionId: ref.externalSessionId,
                sessionRef: ref,
                timestamp: "2026-09-12T12:01:00Z",
                message: kind === "error" ? "Runtime failed" : "Complete",
              },
            };
      receive(event);
      expect(published).toEqual([]);
      if (phase === "loaded") {
        updateWorkspaceSessionQueries(client, "inactive", {
          ...record(),
          manualTitle: "Current title",
        });
      } else baseline.resolve([]);
      await syncing;
      expect(failures).toEqual([]);
      expect(stopped).toBe(0);
      expect(
        client.getQueryData<WorkspaceSession[]>(
          workspaceSessionQueryKeys.list("inactive", false),
        )?.[0]?.manualTitle,
      ).toBe("Current title");
      expect(published).toHaveLength(1);
      expect(published[0]?.navigationTarget).toMatchObject({
        repoPath: ref.repoPath,
        session: {
          externalSessionId: ref.externalSessionId,
          runtimeKind: ref.runtimeKind,
          workingDirectory: ref.workingDirectory,
        },
      });
      expect(published[0]?.task).toBeUndefined();
      receive(event);
      updateWorkspaceSessionQueries(client, "inactive", { ...record(), manualTitle: "Renamed" });
      expect(published).toHaveLength(1);
    } finally {
      observer.dispose();
      client.clear();
    }
  });

  test("opens the exact stored workspace session after workspace selection completes", async () => {
    const selection = Promise.withResolvers<void>();
    const loaded = Promise.withResolvers<void>();
    const navigate = mock(() => {});
    const loadTasks = mock(async () => []);
    const { repoPath, ...session } = ref;
    const opening = navigateToNotificationTarget(
      {
        type: "pending_input",
        repoPath,
        session,
        inputKind: "question",
        requestId: "answer",
      },
      {
        activeWorkspaceId: "active",
        workspaces: [{ workspaceId: "inactive", repoPath }],
        selectWorkspace: () => selection.promise,
        loadTasks,
        loadTaskSessions: async () => [],
        loadWorkspaceSessions: async () => {
          loaded.resolve();
          return [
            { ...record(), id: "wrong-runtime", runtimeKind: "opencode" },
            {
              ...record(),
              id: "wrong-directory",
              executionTarget: { kind: "local_repo_root", workingDirectory: "/elsewhere" },
            },
            record(),
          ];
        },
        navigate,
        reportStale: (message) => {
          throw new Error(message);
        },
        openSettings: () => {},
      },
    );
    await loaded.promise;
    expect(navigate).not.toHaveBeenCalled();
    selection.resolve();
    await opening;
    expect(navigate).toHaveBeenCalledWith(
      "/chats?session=chat&attention=question&attentionId=answer",
      expect.anything(),
    );
    expect(loadTasks).not.toHaveBeenCalled();
  });
});
