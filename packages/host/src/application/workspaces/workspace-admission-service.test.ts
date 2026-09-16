import { describe, expect, test } from "bun:test";
import type { WorkspaceCatalog, WorkspaceRecord } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
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
  ...overrides,
});

const createAdmission = (workspaceCatalog: WorkspaceCatalog) =>
  createWorkspaceAdmissionService({
    workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
      getWorkspaceCatalog: () => Effect.succeed(workspaceCatalog),
    }),
  });

describe("workspace admission service", () => {
  test("loads closed and incomplete removal workspaces", async () => {
    const admission = createAdmission(
      catalog({
        closedWorkspaces: [workspaceRecord("closed-ws", "/repos/closed")],
        incompleteRemovals: [
          {
            workspace: workspaceRecord("removing-ws", "/repos/removing"),
            record: {
              phase: "task_store",
              removeTaskWorktrees: true,
              pendingWorktreePath: null,
            },
          },
        ],
      }),
    );

    await Effect.runPromise(admission.initialize());

    expect(admission.isWorkspaceBlocked("closed-ws")).toBe(true);
    expect(admission.isWorkspaceBlocked("removing-ws")).toBe(true);
    expect(admission.isWorkspaceBlocked("open-ws")).toBe(false);
  });

  test("blocks all ordinary task store access for closed workspaces", async () => {
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
    ).rejects.toThrow("Workspace is closed: closed-ws");
  });

  test("blocks all ordinary task store access while removal is incomplete", async () => {
    const admission = createAdmission(
      catalog({
        incompleteRemovals: [
          {
            workspace: workspaceRecord("removing-ws", "/repos/removing"),
            record: {
              phase: "attachments",
              removeTaskWorktrees: false,
              pendingWorktreePath: null,
            },
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

    await expect(
      Effect.runPromise(admission.withProcessStartAdmission("/repos/closed", Effect.void)),
    ).rejects.toThrow("Workspace is closed: closed-ws");
    await expect(
      Effect.runPromise(admission.withProcessStartAdmission("/repos/open", Effect.void)),
    ).resolves.toBeUndefined();
  });

  test("reserves a workspace and rejects a second reservation", async () => {
    const admission = createAdmission(catalog());

    await Effect.runPromise(
      admission.reserveWorkspace({
        operation: "close",
        repoPath: "/repos/ws",
        workspaceId: "ws",
      }),
    );

    await expect(
      Effect.runPromise(
        admission.reserveWorkspace({
          operation: "remove",
          repoPath: "/repos/ws",
          workspaceId: "ws",
        }),
      ),
    ).rejects.toThrow("already in progress for ws");
    admission.releaseReservation("ws");
    await expect(
      Effect.runPromise(
        admission.reserveWorkspace({
          operation: "remove",
          repoPath: "/repos/ws",
          workspaceId: "ws",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("reservations block process starts and task store access", async () => {
    const admission = createAdmission(catalog());

    await Effect.runPromise(
      admission.reserveWorkspace({
        operation: "close",
        repoPath: "/repos/ws",
        workspaceId: "ws",
      }),
    );

    await expect(
      Effect.runPromise(admission.withProcessStartAdmission("/repos/ws", Effect.void)),
    ).rejects.toThrow("already in progress for ws");
    await expect(
      Effect.runPromise(
        admission.assertTaskStoreAccess({
          operation: "sqliteTaskRepository.listTasks",
          repoPath: "/repos/ws",
          workspaceId: "ws",
        }),
      ),
    ).rejects.toThrow("already in progress for ws");
    await expect(
      Effect.runPromise(
        admission.assertTaskStoreAccess({
          operation: "sqliteTaskRepository.updateTask",
          repoPath: "/repos/ws",
          workspaceId: "ws",
        }),
      ),
    ).rejects.toThrow("already in progress for ws");

    admission.releaseReservation("ws");
    await Effect.runPromise(
      admission.reserveWorkspace({
        operation: "remove",
        repoPath: "/repos/ws",
        workspaceId: "ws",
      }),
    );
    await expect(
      Effect.runPromise(
        admission.assertTaskStoreAccess({
          operation: "sqliteTaskRepository.listTasks",
          repoPath: "/repos/ws",
          workspaceId: "ws",
        }),
      ),
    ).rejects.toThrow("already in progress for ws");
  });

  test("rejects a lifecycle reservation while a process start is active", async () => {
    const admission = createAdmission(catalog());

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const fiber = yield* Effect.fork(
            admission.withProcessStartAdmission(
              "/repos/ws",
              Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(release))),
            ),
          );
          yield* Deferred.await(started);

          const reservation = yield* Effect.either(
            admission.reserveWorkspace({
              operation: "close",
              repoPath: "/repos/ws",
              workspaceId: "ws",
            }),
          );
          expect(reservation).toMatchObject({
            _tag: "Left",
            left: { message: "A process is starting for ws. Wait for it to finish and retry." },
          });

          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(fiber);
        }),
      ),
    );

    await expect(
      Effect.runPromise(
        admission.reserveWorkspace({
          operation: "close",
          repoPath: "/repos/ws",
          workspaceId: "ws",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("keeps administrative access local to its effect", async () => {
    const admission = createAdmission(
      catalog({ closedWorkspaces: [workspaceRecord("closed-ws", "/repos/closed")] }),
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const fiber = yield* Effect.fork(
            admission.withAdministrativeAccess(
              "closed-ws",
              Deferred.succeed(started, undefined).pipe(
                Effect.zipRight(Deferred.await(release)),
                Effect.zipRight(
                  admission.assertTaskStoreAccess({
                    operation: "sqliteTaskRepository.listTasks",
                    repoPath: "/repos/closed",
                    workspaceId: "closed-ws",
                  }),
                ),
              ),
            ),
          );
          yield* Deferred.await(started);

          const ordinaryAccess = yield* Effect.either(
            admission.assertTaskStoreAccess({
              operation: "sqliteTaskRepository.listTasks",
              repoPath: "/repos/closed",
              workspaceId: "closed-ws",
            }),
          );
          expect(ordinaryAccess._tag).toBe("Left");

          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(fiber);
        }),
      ),
    );
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
