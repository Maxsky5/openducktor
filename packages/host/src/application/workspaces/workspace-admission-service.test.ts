import { describe, expect, test } from "bun:test";
import type { WorkspaceCatalog, WorkspaceRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import { createWorkspaceAdmissionService } from "./workspace-admission-service";

const workspaceRecord = (
  workspaceId: string,
  repoPath: string,
  isActive = false,
): WorkspaceRecord => ({
  workspaceId,
  workspaceName: workspaceId,
  repoPath,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: `/managed/${workspaceId}`,
  effectiveWorktreeBasePath: `/managed/${workspaceId}`,
});

const catalog = (overrides: Partial<WorkspaceCatalog> = {}): WorkspaceCatalog => ({
  openWorkspaces: [],
  closedWorkspaces: [],
  incompleteRemovals: [],
  onboardingCompleted: true,
  ...overrides,
});

const createAdmission = (workspaceCatalog: WorkspaceCatalog) =>
  createWorkspaceAdmissionService({
    workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
      getWorkspaceCatalog: () => Effect.succeed(workspaceCatalog),
    }),
  });

describe("workspace admission service", () => {
  test("hydrates closed and incomplete removal workspaces", async () => {
    const admission = createAdmission(
      catalog({
        closedWorkspaces: [workspaceRecord("closed-ws", "/repos/closed")],
        incompleteRemovals: [
          {
            workspace: workspaceRecord("removing-ws", "/repos/removing"),
            operationId: "op-1",
            phase: "task_store",
            removeTaskWorktrees: true,
            removedWorktrees: [],
            lastFailure: null,
          },
        ],
      }),
    );

    await Effect.runPromise(admission.initialize());

    expect(admission.isWorkspaceBlocked("closed-ws")).toBe(true);
    expect(admission.isWorkspaceBlocked("removing-ws")).toBe(true);
    expect(admission.isWorkspaceBlocked("open-ws")).toBe(false);
  });

  test("blocks task store writes for closed workspaces but allows reads", async () => {
    const admission = createAdmission(
      catalog({ closedWorkspaces: [workspaceRecord("closed-ws", "/repos/closed")] }),
    );

    await expect(
      Effect.runPromise(
        admission.assertTaskStoreAccess({
          operation: "sqliteTaskRepository.createTask",
          repoPath: "/repos/closed",
          workspaceId: "closed-ws",
        }),
      ),
    ).rejects.toThrow("Workspace is closed: closed-ws");

    await expect(
      Effect.runPromise(
        admission.assertTaskStoreAccess({
          operation: "sqliteTaskRepository.listTasks",
          repoPath: "/repos/closed",
          workspaceId: "closed-ws",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("blocks all ordinary task store access while removal is incomplete", async () => {
    const admission = createAdmission(
      catalog({
        incompleteRemovals: [
          {
            workspace: workspaceRecord("removing-ws", "/repos/removing"),
            operationId: "op-1",
            phase: "attachments",
            removeTaskWorktrees: false,
            removedWorktrees: [],
            lastFailure: null,
          },
        ],
      }),
    );

    await expect(
      Effect.runPromise(
        admission.assertTaskStoreAccess({
          operation: "sqliteTaskRepository.listTasks",
          repoPath: "/repos/removing",
          workspaceId: "removing-ws",
        }),
      ),
    ).rejects.toThrow("Workspace removal is incomplete for removing-ws");

    await expect(
      Effect.runPromise(
        admission.withAdministrativeAccess(
          "removing-ws",
          admission.assertTaskStoreAccess({
            operation: "sqliteTaskRepository.listTasks",
            repoPath: "/repos/removing",
            workspaceId: "removing-ws",
          }),
        ),
      ),
    ).resolves.toBeUndefined();
  });

  test("blocks process starts by repository path for blocked workspaces", async () => {
    const admission = createAdmission(
      catalog({ closedWorkspaces: [workspaceRecord("closed-ws", "/repos/closed")] }),
    );

    await expect(Effect.runPromise(admission.assertProcessStart("/repos/closed"))).rejects.toThrow(
      "Workspace is closed: closed-ws",
    );
    await expect(
      Effect.runPromise(admission.assertProcessStart("/repos/open")),
    ).resolves.toBeUndefined();
  });

  test("tracks block and unblock changes after initialization", async () => {
    const admission = createAdmission(catalog());

    await Effect.runPromise(admission.initialize());
    admission.blockWorkspace({
      reason: "closed",
      repoPath: "/repos/new-closed",
      workspaceId: "new-closed",
    });
    expect(admission.isWorkspaceBlocked("new-closed")).toBe(true);

    admission.unblockWorkspace("new-closed");
    expect(admission.isWorkspaceBlocked("new-closed")).toBe(false);

    admission.blockWorkspace({
      reason: "removal",
      repoPath: "/repos/removed",
      workspaceId: "removed",
    });
    admission.forgetWorkspace("removed");
    expect(admission.isWorkspaceBlocked("removed")).toBe(false);
  });
});
