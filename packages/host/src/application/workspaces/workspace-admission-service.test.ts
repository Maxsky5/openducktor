import { describe, expect, test } from "bun:test";
import type { WorkspaceCatalog, WorkspaceRecord } from "@openducktor/contracts";
import { Deferred, Effect, Fiber, Option } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
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

const createAdmission = (
  workspaceCatalog: WorkspaceCatalog,
  canonicalizePath: (path: string) => Effect.Effect<string, HostOperationErrorAggregate> = (path) =>
    Effect.succeed(path),
) =>
  createWorkspaceAdmissionService({
    settingsConfig: { canonicalizePath },
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
              version: 1,
              operationId: "op-1",
              phase: "task_store",
              removeTaskWorktrees: true,
              removedWorktrees: [],
              pendingWorktreePath: null,
              startedAt: "2026-01-01T00:00:00.000Z",
              lastFailure: null,
            },
          },
        ],
      }),
    );

    await Effect.runPromise(admission.initialize());

    expect(admission.isWorkspaceBlocked("closed-ws")).toBe(true);
    expect(admission.isWorkspaceBlocked("removing-ws")).toBe(true);
    expect(admission.isWorkspaceBlocked("open-ws")).toBe(false);
    expect(admission.isWorkspaceRemovalPending("closed-ws")).toBe(false);
    expect(admission.isWorkspaceRemovalPending("removing-ws")).toBe(true);
    expect(admission.isWorkspaceRemovalPending("open-ws")).toBe(false);
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
            record: {
              version: 1,
              operationId: "op-1",
              phase: "attachments",
              removeTaskWorktrees: false,
              removedWorktrees: [],
              pendingWorktreePath: null,
              startedAt: "2026-01-01T00:00:00.000Z",
              lastFailure: null,
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
      Effect.runPromise(admission.assertWorkspaceAdmitsWork("/repos/closed")),
    ).rejects.toThrow("Workspace is closed: closed-ws");
    await expect(
      Effect.runPromise(admission.assertWorkspaceAdmitsWork("/repos/open")),
    ).resolves.toBeUndefined();
  });

  test("matches a work start by the canonical repository path", async () => {
    const admission = createAdmission(catalog(), (path) =>
      Effect.succeed(path === "/alias/open" ? "/repos/open" : path),
    );
    await Effect.runPromise(admission.initialize());

    const waited = await Effect.runPromise(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const start = yield* Effect.fork(
          admission.withWorkStartLease(
            "/alias/open",
            Deferred.succeed(entered, undefined).pipe(Effect.zipRight(Deferred.await(release))),
          ),
        );
        yield* Deferred.await(entered);
        const waitForStarts = yield* Effect.fork(admission.awaitWorkStarts("/repos/open"));
        yield* Effect.sleep("20 millis");
        const beforeRelease = yield* Fiber.poll(waitForStarts);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(start);
        yield* Fiber.join(waitForStarts);
        return beforeRelease;
      }),
    );

    expect(Option.isNone(waited)).toBe(true);
  });

  test("blocks a work start when the canonical path has a reservation", async () => {
    const admission = createAdmission(catalog(), (path) =>
      Effect.succeed(path === "/alias/open" ? "/repos/open" : path),
    );
    await Effect.runPromise(
      admission.reserveWorkspace({
        operation: "close",
        repoPath: "/repos/open",
        workspaceId: "open",
      }),
    );

    await expect(
      Effect.runPromise(admission.assertWorkspaceAdmitsWork("/alias/open")),
    ).rejects.toThrow("already in progress for open");
  });

  test("reports a canonicalization failure for a work start", async () => {
    const admission = createAdmission(catalog(), () =>
      Effect.fail(
        new HostOperationError({
          operation: "git.canonicalizePath",
          message: "Failed to canonicalize /repos/missing.",
        }),
      ),
    );

    await expect(
      Effect.runPromise(admission.assertWorkspaceAdmitsWork("/repos/missing")),
    ).rejects.toThrow("Cannot resolve the repository path /repos/missing.");
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

  test("reservations block process starts and gate task store access by operation", async () => {
    const admission = createAdmission(catalog());

    await Effect.runPromise(
      admission.reserveWorkspace({
        operation: "close",
        repoPath: "/repos/ws",
        workspaceId: "ws",
      }),
    );

    await expect(
      Effect.runPromise(admission.assertWorkspaceAdmitsWork("/repos/ws")),
    ).rejects.toThrow("already in progress for ws");
    await expect(
      Effect.runPromise(
        admission.assertTaskStoreAccess({
          operation: "sqliteTaskRepository.listTasks",
          repoPath: "/repos/ws",
          workspaceId: "ws",
        }),
      ),
    ).resolves.toBeUndefined();
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

  test("holds a work start lease until the operation finishes", async () => {
    const admission = createAdmission(catalog());
    await Effect.runPromise(admission.initialize());

    const { closeExit, releaseExit } = await Effect.runPromise(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const start = yield* Effect.fork(
          admission.withWorkStartLease(
            "/repos/open",
            Deferred.succeed(entered, undefined).pipe(Effect.zipRight(Deferred.await(release))),
          ),
        );
        yield* Deferred.await(entered);
        const waitForStarts = yield* Effect.fork(admission.awaitWorkStarts("/repos/open"));
        yield* Effect.sleep("20 millis");
        const waitExitBeforeRelease = yield* Fiber.poll(waitForStarts);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(start);
        yield* Fiber.join(waitForStarts);
        return {
          closeExit: waitExitBeforeRelease,
          releaseExit: yield* Fiber.poll(waitForStarts),
        };
      }),
    );

    expect(Option.isNone(closeExit)).toBe(true);
    expect(Option.isSome(releaseExit)).toBe(true);
  });

  test("keeps the drain waiter when a rejected start arrives during the drain", async () => {
    const admission = createAdmission(
      catalog({ openWorkspaces: [workspaceRecord("open", "/repos/open")] }),
    );
    await Effect.runPromise(admission.initialize());

    const { rejectedExit } = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const start = yield* Effect.fork(
          admission.withWorkStartLease(
            "/repos/open",
            Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(release))),
          ),
        );
        yield* Deferred.await(started);
        yield* admission.reserveWorkspace({
          operation: "close",
          repoPath: "/repos/open",
          workspaceId: "open",
        });
        const waitForStarts = yield* Effect.fork(admission.awaitWorkStarts("/repos/open"));
        yield* Effect.sleep("20 millis");
        const rejectedExit = yield* Effect.exit(
          admission.withWorkStartLease("/repos/open", Effect.void),
        );
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(start);
        yield* Fiber.join(waitForStarts);
        return { rejectedExit };
      }),
    );

    expect(rejectedExit._tag).toBe("Failure");
  });

  test("releases the work start lease when the workspace is blocked", async () => {
    const admission = createAdmission(
      catalog({ closedWorkspaces: [workspaceRecord("closed-ws", "/repos/closed")] }),
    );

    const error = await Effect.runPromise(
      Effect.flip(
        admission.withWorkStartLease(
          "/repos/closed",
          Effect.dieMessage("a blocked workspace must not start work"),
        ),
      ),
    );

    expect(error.message).toContain("Workspace is closed");
    await expect(
      Effect.runPromise(admission.awaitWorkStarts("/repos/closed")),
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
