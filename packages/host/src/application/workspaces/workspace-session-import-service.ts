import {
  workspaceSessionExternalSchema,
  type WorkspaceSessionExternal,
  type WorkspaceSessionExternalListInput,
  type WorkspaceSessionExternalListResult,
  type WorkspaceSessionImportInput,
  type WorkspaceSessionImportResult,
  type WorkspaceSessionExecutionTarget,
} from "@openducktor/contracts";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, FiberId } from "effect";
import {
  type HostError,
  toHostOperationError,
  HostValidationError,
  HostOperationError,
  hasNestedNodeErrorCode,
} from "../../effect/host-errors";
import type { AgentSessionLiveAdapterRegistryPort } from "../../ports/agent-session-live-adapter-port";
import type { WorkspaceSessionServiceDependencies } from "./workspace-session-service";
import type { WorkspaceSessionUpdatedPublisher } from "./workspace-session-runtime-persistence";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";

const MAX_CATALOGS = 8;
const MAX_RECORDS = 100_000;
const MAX_BYTES = 64 * 1024 * 1024;
const LIFETIME = 10 * 60_000;
const invalid = (message: string) =>
  new HostValidationError({ field: "externalSessionId", message });
type Catalog = {
  workspaceId: string;
  runtimeKind: string;
  repoPath: string;
  runtimeId: string;
  controller: AbortController;
  result: Deferred.Deferred<WorkspaceSessionExternal[], HostError>;
  fiber?: Fiber.RuntimeFiber<void, never>;
  expiry?: Fiber.RuntimeFiber<void, never>;
  cursors: Map<string, { search: string; offset: number; pageSize: number }>;
  gate: Effect.Semaphore;
  readers: Set<Fiber.RuntimeFiber<WorkspaceSessionExternal[], HostError>>;
  failure?: HostError;
  discovery?: {
    owned: Set<string>;
    allowed: Set<string>;
    eligibleDirectories: Map<string, boolean>;
    records: Map<string, WorkspaceSessionExternal>;
    cursors: Set<string>;
    cursor?: string | undefined;
    done: boolean;
    bytes: number;
    scanned: number;
  };
};
type Dependencies = Pick<WorkspaceSessionServiceDependencies, "store" | "runtime" | "git"> & {
  settings: Pick<WorkspaceSessionServiceDependencies["settings"], "getRepoConfig">;
  registry: AgentSessionLiveAdapterRegistryPort;
  publishUpdated: WorkspaceSessionUpdatedPublisher;
  lifecycle: TaskSessionLifecycleCoordinator;
};

export const createWorkspaceSessionImportService = (dependencies: Dependencies) => {
  const { settings, runtime, git, registry, publishUpdated, lifecycle } = dependencies;
  const store = {
    listRuntimeOwners: (input: Parameters<Dependencies["store"]["listRuntimeOwners"]>[0]) =>
      dependencies.store
        .listRuntimeOwners(input)
        .pipe(
          Effect.mapError((cause) => toHostOperationError(cause, "workspaceSessionImport.owners")),
        ),
    findByRuntimeSession: (input: Parameters<Dependencies["store"]["findByRuntimeSession"]>[0]) =>
      dependencies.store
        .findByRuntimeSession(input)
        .pipe(
          Effect.mapError((cause) => toHostOperationError(cause, "workspaceSessionImport.find")),
        ),
    importSession: (input: Parameters<Dependencies["store"]["importSession"]>[0]) =>
      dependencies.store
        .importSession(input)
        .pipe(
          Effect.mapError((cause) => toHostOperationError(cause, "workspaceSessionImport.save")),
        ),
  };
  const catalogs = new Map<string, Catalog>();
  const importGate = Effect.unsafeMakeSemaphore(1);
  const scopeFor = (workspaceId: string) =>
    Effect.gen(function* () {
      const config = yield* settings
        .getRepoConfig(workspaceId)
        .pipe(
          Effect.mapError((cause) => toHostOperationError(cause, "workspaceSessionImport.scope")),
        );
      return { workspaceId, repoPath: yield* git.canonicalizePath(config.repoPath) };
    });
  const release = (input: { workspaceId: string; catalogRequestId: string }) =>
    Effect.gen(function* () {
      const entry = catalogs.get(input.catalogRequestId);
      if (!entry || entry.workspaceId !== input.workspaceId) return;
      catalogs.delete(input.catalogRequestId);
      entry.controller.abort();
      yield* Deferred.fail(
        entry.result,
        invalid("Session discovery was closed. Reopen Import session."),
      );
      if (entry.fiber) yield* Fiber.interruptFork(entry.fiber);
      yield* Effect.forEach(entry.readers, Fiber.interruptFork, { discard: true });
      if (entry.expiry) yield* Fiber.interruptFork(entry.expiry);
    });
  const targetFor = (repoPath: string, workingDirectory: string) =>
    Effect.gen(function* () {
      const canonical = yield* git.canonicalizePath(workingDirectory);
      if (!(yield* git.isGitRepository(canonical)))
        return yield* invalid(
          `Directory is unavailable: ${workingDirectory}. Restore it before importing.`,
        );
      if (canonical === repoPath)
        return {
          kind: "local_repo_root",
          workingDirectory,
        } satisfies WorkspaceSessionExecutionTarget;
      if (
        !(yield* git.shareGitCommonDirectory(repoPath, canonical)) ||
        !(yield* git.isRegisteredWorktree(repoPath, canonical))
      )
        return yield* invalid(
          "The source directory is not a registered worktree of this workspace.",
        );
      const branch = yield* git.getCurrentBranch(canonical);
      return {
        kind: "local_worktree",
        workingDirectory,
        branchName: branch.detached ? null : (branch.name ?? null),
        worktreeState: "present",
      } satisfies WorkspaceSessionExecutionTarget;
    });
  const candidateDirectory = (directory: string) =>
    git.canonicalizePath(directory).pipe(
      Effect.catchAll((cause) => {
        if (hasNestedNodeErrorCode(cause, "ENOENT") || hasNestedNodeErrorCode(cause, "ENOTDIR"))
          return Effect.succeed(null);
        return Effect.fail(
          new HostOperationError({
            operation: "workspaceSessionImport.directory",
            message: `Cannot check session directory '${directory}': ${cause.message}. Check directory access and retry discovery.`,
            cause,
          }),
        );
      }),
    );
  const collect = (
    entry: Catalog,
    adapter: Parameters<AgentSessionLiveAdapterRegistryPort["register"]>[0],
    search: string,
    count: number,
  ) =>
    Effect.gen(function* () {
      if (entry.failure) return yield* entry.failure;
      if (!entry.discovery) {
        const owners = yield* store.listRuntimeOwners({
          workspaceId: entry.workspaceId,
          repoPath: entry.repoPath,
        });
        const owned = new Set(
          owners
            .filter((owner) => owner.runtimeKind === entry.runtimeKind)
            .map((owner) => owner.externalSessionId),
        );
        const worktrees = yield* git.listWorktrees(entry.repoPath);
        const allowed = new Set([entry.repoPath]);
        for (const tree of worktrees) {
          const directory = yield* candidateDirectory(tree.worktreePath);
          if (directory !== null) allowed.add(directory);
        }
        entry.discovery = {
          owned,
          allowed,
          eligibleDirectories: new Map(),
          records: new Map(),
          cursors: new Set(),
          done: false,
          bytes: 0,
          scanned: 0,
        };
      }
      const state = entry.discovery;
      const { owned, allowed, eligibleDirectories, records, cursors } = state;
      const matches = () =>
        [...records.values()].filter((row) =>
          [row.title, row.externalSessionId, row.workingDirectory].some((value) =>
            value?.toLowerCase().includes(search),
          ),
        );
      while (!state.done && matches().length < count) {
        const request: Parameters<typeof adapter.sessionImport.listRootSessionMetadataPage>[0] = {
          signal: entry.controller.signal,
        };
        if (state.cursor) request.pageToken = state.cursor;
        const page = yield* adapter.sessionImport.listRootSessionMetadataPage(request);
        for (const raw of page.sessions) {
          state.bytes += JSON.stringify(raw).length * 2;
          if (++state.scanned > MAX_RECORDS || state.bytes > MAX_BYTES)
            return yield* invalid(
              "Session discovery exceeds the metadata capacity. Reduce native history and retry.",
            );
          const row = yield* Effect.try({
            try: () => workspaceSessionExternalSchema.parse(raw),
            catch: () =>
              invalid(
                "The runtime returned invalid session metadata. Update the runtime and retry.",
              ),
          });
          if (row.runtimeKind !== entry.runtimeKind)
            return yield* invalid("The runtime returned a different session kind.");
          if (owned.has(row.externalSessionId)) continue;
          let eligible = eligibleDirectories.get(row.workingDirectory);
          if (eligible === undefined) {
            const path = yield* candidateDirectory(row.workingDirectory);
            eligible = path !== null && allowed.has(path);
            eligibleDirectories.set(row.workingDirectory, eligible);
          }
          if (!eligible || records.has(row.externalSessionId)) continue;

          records.set(row.externalSessionId, row);
        }
        state.cursor = page.nextPageToken ?? undefined;
        state.done = !state.cursor;
        if (state.cursor) {
          if (cursors.has(state.cursor))
            return yield* invalid(
              "The runtime repeated a session page. Update the runtime and retry discovery.",
            );
          cursors.add(state.cursor);
        }
      }
      const current = yield* registry.resolveForScope({
        repoPath: entry.repoPath,
        runtimeKind: adapter.binding.runtimeKind,
      });
      if (current.binding !== adapter.binding)
        return yield* invalid("The selected runtime restarted. Reload sessions.");
      return [...records.values()];
    });
  const list = (
    input: WorkspaceSessionExternalListInput,
  ): Effect.Effect<WorkspaceSessionExternalListResult, HostError> =>
    Effect.gen(function* () {
      let entry = catalogs.get(input.catalogRequestId);
      if (!entry) {
        if (input.cursor) return yield* invalid("This session catalog expired. Reload sessions.");
        if (catalogs.size >= MAX_CATALOGS)
          return yield* invalid(
            "Too many session catalogs are open. Close another import dialog and retry.",
          );
        entry = {
          workspaceId: input.workspaceId,
          repoPath: "",
          runtimeKind: input.runtimeKind,
          runtimeId: "",
          controller: new AbortController(),
          result: Deferred.unsafeMake<WorkspaceSessionExternal[], HostError>(FiberId.none),
          cursors: new Map(),
          gate: Effect.unsafeMakeSemaphore(1),
          readers: new Set(),
        };
        catalogs.set(input.catalogRequestId, entry);
        const selected = entry;
        const discover = Effect.gen(function* () {
          const scope = yield* scopeFor(input.workspaceId);
          selected.repoPath = scope.repoPath;
          yield* runtime
            .runtimeEnsure({ repoPath: scope.repoPath, runtimeKind: input.runtimeKind })
            .pipe(
              Effect.mapError((cause) =>
                toHostOperationError(cause, "workspaceSessionImport.runtime"),
              ),
            );
          const adapter = yield* registry.resolveForScope({
            repoPath: scope.repoPath,
            runtimeKind: input.runtimeKind,
          });
          selected.runtimeId = adapter.binding.runtimeId;
          return yield* collect(selected, adapter, input.search.toLowerCase(), input.pageSize);
        });
        selected.fiber = yield* Effect.forkDaemon(
          discover.pipe(
            Effect.exit,
            Effect.flatMap((exit) => Deferred.done(selected.result, exit)),
            Effect.asVoid,
          ),
        );
        selected.expiry = yield* Effect.forkDaemon(
          Effect.sleep(LIFETIME).pipe(Effect.zipRight(release(input))),
        );
      }
      if (entry.workspaceId !== input.workspaceId || entry.runtimeKind !== input.runtimeKind)
        return yield* invalid("Workspace or runtime changed. Reload sessions.");
      yield* Deferred.await(entry.result);
      const current = yield* registry.resolveForScope({
        repoPath: entry.repoPath,
        runtimeKind: input.runtimeKind,
      });
      if (current.binding.runtimeId !== entry.runtimeId)
        return yield* invalid("The runtime restarted. Reload sessions.");
      const search = input.search.toLowerCase();
      const page = input.cursor
        ? entry.cursors.get(input.cursor)
        : { search, offset: 0, pageSize: input.pageSize };
      if (!page || page.search !== search || page.pageSize !== input.pageSize)
        return yield* invalid("The search cursor is invalid. Reload sessions.");
      const selected = entry;
      const reader = yield* Effect.forkDaemon(
        entry.gate.withPermits(1)(
          collect(entry, current, search, page.offset + input.pageSize).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                selected.failure = error;
              }),
            ),
          ),
        ),
      );
      entry.readers.add(reader);
      const records = yield* Fiber.join(reader).pipe(
        Effect.ensuring(
          Fiber.interrupt(reader).pipe(
            Effect.zipRight(Effect.sync(() => selected.readers.delete(reader))),
          ),
        ),
      );
      const matches = records.filter((row) =>
        [row.title, row.externalSessionId, row.workingDirectory].some((value) =>
          value?.toLowerCase().includes(search),
        ),
      );
      const end = page.offset + input.pageSize;
      const nextCursor =
        end < matches.length || !entry.discovery?.done ? crypto.randomUUID() : null;
      if (entry.cursors.size >= 2000)
        return yield* invalid("The search catalog reached its page limit. Reload sessions.");
      if (nextCursor)
        entry.cursors.set(nextCursor, { search, offset: end, pageSize: input.pageSize });
      return {
        catalogId: input.catalogRequestId,
        sessions: matches.slice(page.offset, end),
        nextCursor,
      };
    });
  const importSession = (
    input: WorkspaceSessionImportInput,
  ): Effect.Effect<WorkspaceSessionImportResult, HostError> =>
    Effect.suspend(() => {
      return importGate.withPermits(1)(
        Effect.gen(function* () {
          const scope = yield* scopeFor(input.workspaceId);
          const existing = yield* store.findByRuntimeSession({
            ...scope,
            runtimeKind: input.runtimeKind,
            externalSessionId: input.externalSessionId,
          });
          if (existing) {
            if (existing.archivedAt !== null)
              return yield* invalid(
                "This conversation belongs to an archived chat. Restore it from archived sessions.",
              );
            return { session: existing, created: false, openError: null };
          }
          const owners = yield* store.listRuntimeOwners(scope);
          const task = owners.find(
            (owner) =>
              owner.runtimeKind === input.runtimeKind &&
              owner.externalSessionId === input.externalSessionId,
          );
          if (task?.kind === "task")
            return yield* invalid(
              `This conversation belongs to task ${task.taskId} (${task.role}).`,
            );
          yield* runtime
            .runtimeEnsure({ repoPath: scope.repoPath, runtimeKind: input.runtimeKind })
            .pipe(
              Effect.mapError((cause) =>
                toHostOperationError(cause, "workspaceSessionImport.runtime"),
              ),
            );
          const adapter = yield* registry.resolveForScope({
            repoPath: scope.repoPath,
            runtimeKind: input.runtimeKind,
          });
          const canonical = yield* git.canonicalizePath(input.workingDirectory);
          const ref = {
            repoPath: scope.repoPath,
            runtimeKind: input.runtimeKind,
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          };
          const { source, saved } = yield* lifecycle.runWorktreeRead(
            canonical,
            Effect.gen(function* () {
              const source = yield* adapter.sessionImport.openExistingSessionForImport(ref);
              if (
                source.metadata.externalSessionId !== input.externalSessionId ||
                source.metadata.workingDirectory !== input.workingDirectory ||
                source.metadata.runtimeKind !== input.runtimeKind
              )
                return yield* invalid("The source conversation changed. Reload sessions.");
              const current = yield* registry.resolveForScope(ref);
              if (current.binding !== adapter.binding)
                return yield* invalid("The selected runtime restarted. Reload sessions.");
              const target = yield* targetFor(scope.repoPath, input.workingDirectory);
              const now = yield* Clock.currentTimeMillis;
              const saved = yield* store.importSession({
                ...scope,
                session: {
                  id: crypto.randomUUID(),
                  runtimeKind: input.runtimeKind,
                  externalSessionId: input.externalSessionId,
                  executionTarget: target,
                  manualTitle: source.metadata.title || null,
                  generatedTitle: null,
                  roleSnapshot: null,
                  selectedModel: source.selectedModel ?? null,
                  createdAt: now,
                  updatedAt: now,
                  archivedAt: null,
                },
              });
              return { source, saved };
            }),
          );
          if (!saved.created) return { ...saved, openError: null };
          const opened = yield* Effect.exit(
            source.registerLiveSession.pipe(
              Effect.zipRight(publishUpdated(input.workspaceId, saved.session)),
            ),
          );
          return {
            ...saved,
            openError: Exit.isFailure(opened)
              ? `The chat was saved, but opening failed: ${Cause.pretty(opened.cause)}. Open the saved chat to retry.`
              : null,
          };
        }),
      );
    });
  return {
    list,
    release,
    releaseRuntime: (repoPath: string, runtimeKind: string) =>
      Effect.forEach(
        [...catalogs.entries()].filter(
          ([, entry]) => entry.repoPath === repoPath && entry.runtimeKind === runtimeKind,
        ),
        ([catalogRequestId, entry]) =>
          release({ workspaceId: entry.workspaceId, catalogRequestId }),
        { discard: true },
      ),
    importSession,
    shutdown: () =>
      Effect.forEach(
        [...catalogs.entries()],
        ([catalogRequestId, entry]) =>
          release({ workspaceId: entry.workspaceId, catalogRequestId }),
        { discard: true },
      ),
  };
};
