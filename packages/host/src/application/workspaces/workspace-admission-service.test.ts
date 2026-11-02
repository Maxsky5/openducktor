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
  abbreviation: null,
  tileColor: null,
  repoPath,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: `/managed/${workspaceId}`,
  effectiveWorktreeBasePath: `/managed/${workspaceId}`,
});

const catalog = (overrides: Partial<WorkspaceCatalog> = {}): WorkspaceCatalog => ({
  catalogRevision: 0,
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

  test.each(["close", "reopen", "remove"] as const)(
    "ownership reads permit closed workspaces but reject a %s reservation",
    async (operation) => {
      const admission = createAdmission(
        catalog({
          closedWorkspaces: [workspaceRecord("closed-ws", "/repos/closed")],
        }),
      );
      const scope = { workspaceId: "closed-ws", repoPath: "/repos/closed" };
      const read = () =>
        admission.resolveTaskStoreAccess({
          ...scope,
          access: "ownership",
          operation: "workspaceSessionStore.worktreeOwners",
        });
      expect(await Effect.runPromise(read())).toBe("ownership");
      await Effect.runPromise(admission.reserveWorkspace({ ...scope, operation }));
      await expect(Effect.runPromise(read())).rejects.toThrow(
        `${operation} operation is already in progress`,
      );
      admission.releaseReservation(scope.workspaceId);
      await Effect.runPromise(read());
    },
  );

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
        admission.resolveTaskStoreAccess({
          access: "open",
          operation: "sqliteTaskRepository.listTasks",
          repoPath: "/repos/ws",
          workspaceId: "ws",
        }),
      ),
    ).rejects.toThrow("already in progress for ws");
    await expect(
      Effect.runPromise(
        admission.resolveTaskStoreAccess({
          access: "open",
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
        admission.resolveTaskStoreAccess({
          access: "open",
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
          const fiber = yield* Effect.forkChild(
            admission.withProcessStartAdmission(
              "/repos/ws",
              Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
            ),
          );
          yield* Deferred.await(started);

          const reservation = yield* Effect.result(
            admission.reserveWorkspace({
              operation: "close",
              repoPath: "/repos/ws",
              workspaceId: "ws",
            }),
          );
          expect(reservation).toMatchObject({
            _tag: "Failure",
            failure: { message: "A process is starting for ws. Wait for it to finish and retry." },
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
      admission.reserveWorkspace({
        workspaceId: "closed-ws",
        repoPath: "/repos/closed",
        operation: "close",
      }),
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const fiber = yield* Effect.forkChild(
            admission.withAdministrativeAccess(
              "closed-ws",
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(
                  admission.resolveTaskStoreAccess({
                    access: "open",
                    operation: "sqliteTaskRepository.listTasks",
                    repoPath: "/repos/closed",
                    workspaceId: "closed-ws",
                  }),
                ),
              ),
            ),
          );
          yield* Deferred.await(started);

          const ordinaryAccess = yield* Effect.result(
            admission.resolveTaskStoreAccess({
              access: "open",
              operation: "sqliteTaskRepository.listTasks",
              repoPath: "/repos/closed",
              workspaceId: "closed-ws",
            }),
          );
          expect(ordinaryAccess._tag).toBe("Failure");

          yield* Deferred.succeed(release, undefined);
          expect(yield* Fiber.join(fiber)).toBe("administrative");
        }),
      ),
    );
  });

  test("keeps administrative access local to its service instance", async () => {
    const closed = catalog({ closedWorkspaces: [workspaceRecord("closed-ws", "/repos/closed")] });
    const admission = createAdmission(closed);
    const otherAdmission = createAdmission(closed);
    const access = {
      access: "open" as const,
      operation: "sqliteTaskRepository.listTasks",
      repoPath: "/repos/closed",
      workspaceId: "closed-ws",
    };

    await Effect.runPromise(
      admission.reserveWorkspace({
        workspaceId: "closed-ws",
        repoPath: "/repos/closed",
        operation: "close",
      }),
    );
    await Effect.runPromise(
      otherAdmission.reserveWorkspace({
        workspaceId: "closed-ws",
        repoPath: "/repos/closed",
        operation: "close",
      }),
    );

    const [own, other] = await Effect.runPromise(
      admission.withAdministrativeAccess(
        "closed-ws",
        Effect.all([
          Effect.result(admission.resolveTaskStoreAccess(access)),
          Effect.result(otherAdmission.resolveTaskStoreAccess(access)),
        ]),
      ),
    );

    expect(own).toEqual(expect.objectContaining({ _tag: "Success", success: "administrative" }));
    expect(other._tag).toBe("Failure");
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
