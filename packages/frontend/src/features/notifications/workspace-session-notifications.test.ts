import { describe, expect, mock, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
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
describe("Workspace Session notifications", () => {
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
      "/sessions?workspace=inactive&kind=workspace&session=chat&attention=question&attentionId=answer",
      expect.anything(),
    );
    expect(loadTasks).not.toHaveBeenCalled();
  });
});
