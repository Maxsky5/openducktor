import type {
  RepoRuntimeRef,
  RuntimeDescriptor,
  RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { hasNestedNodeErrorCode } from "../../effect/host-errors";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type {
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterRegistryPort,
} from "../../ports/agent-session-live-adapter-port";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { resolveRepoPath } from "./runtime-orchestrator-model";
import { requireSessionScope, type QueryInput } from "./runtime-query-scope";
import { requireRuntimeWorkingDirectory } from "./runtime-working-directory";
import {
  requireManagedHistoryDirectory,
  type RuntimeHistoryWorkingDirectoryDependencies,
} from "./runtime-history-working-directory";
import { runtimeQueryError, type RuntimeQueryError } from "../../ports/runtime-query-error";

export type AgentRuntimeQueryDependencies = RuntimeHistoryWorkingDirectoryDependencies & {
  adapterRegistry: AgentSessionLiveAdapterRegistryPort;
  runtimeRegistry: Pick<RuntimeRegistryPort, "findWorkspaceRuntime">;
  gitPort: Pick<GitPort, "canonicalizePath" | "isGitRepository">;
  taskReader: Pick<TaskReader, "getTaskMetadata">;
  worktreeReads: Pick<TaskSessionLifecycleCoordinator, "runWorktreeRead">;
};

type QueryMethod = keyof AgentRuntimeQueryPort;

/**
 * Hold the worktree read guard until the query finishes and the host checks its runtime binding again.
 * A replaced runtime must not supply data for its replacement.
 */
export const createAgentRuntimeQueryService = (
  dependencies: AgentRuntimeQueryDependencies,
): AgentRuntimeQueryPort => {
  const read = <Input extends QueryInput, Result>(
    method: QueryMethod,
    input: Input,
    invoke: (
      queries: AgentRuntimeQueryPort,
      input: Input,
    ) => Effect.Effect<Result, RuntimeQueryError>,
  ): Effect.Effect<Result, RuntimeQueryError> =>
    Effect.gen(function* () {
      const repoPath = yield* resolveRepoPath(dependencies.gitPort, input.repoPath).pipe(
        Effect.mapError((cause) =>
          runtimeQueryError(
            method,
            input,
            "scope_mismatch",
            "The selected repository is missing or inaccessible. Check the repository path.",
            cause,
          ),
        ),
      );
      const request = { ...input, repoPath };
      const directory = input.workingDirectory ?? repoPath;
      const directoryFailure = (cause: unknown) =>
        runtimeQueryError(
          method,
          request,
          "scope_mismatch",
          "The working directory is missing, inaccessible, or outside the selected workspace. Select an existing workspace directory.",
          cause,
        );
      return yield* dependencies.worktreeReads.runWorktreeRead(
        directory,
        Effect.gen(function* () {
          const readsRemovedWorktree = yield* requireRuntimeWorkingDirectory(dependencies, {
            repoPath,
            workingDirectory: directory,
          }).pipe(
            Effect.as(false),
            Effect.catchTag("HostOperationError", (cause) =>
              method === "loadSessionHistory" &&
              input.sessionScope?.kind === "workflow" &&
              hasNestedNodeErrorCode(cause, "ENOENT")
                ? Effect.succeed(true)
                : Effect.fail(cause),
            ),
            Effect.mapError(directoryFailure),
          );
          const { runtime, adapter } = yield* resolveAdapter(request, method);
          if (!supportsQuery(runtime.descriptor, method)) {
            return yield* runtimeQueryError(
              method,
              request,
              "unsupported_operation",
              `${runtime.descriptor.label} does not support this read.`,
            );
          }
          yield* requireSessionScope(dependencies.taskReader, adapter, request, method);
          if (readsRemovedWorktree) {
            yield* requireManagedHistoryDirectory(dependencies, {
              repoPath,
              workingDirectory: directory,
            }).pipe(Effect.mapError(directoryFailure));
          }
          const result = yield* invoke(adapter.queries, request);
          const current = yield* resolveAdapter(request, method);
          if (current.adapter !== adapter) {
            return yield* runtimeQueryError(
              method,
              request,
              "runtime_unavailable",
              "The runtime changed during this read. Reload the runtime data.",
            );
          }
          return result;
        }),
      );
    });

  return {
    listAvailableModels: (input) =>
      read("listAvailableModels", input, (queries, request) =>
        queries.listAvailableModels(request),
      ),
    listAvailableSlashCommands: (input) =>
      read("listAvailableSlashCommands", input, (queries, request) =>
        queries.listAvailableSlashCommands(request),
      ),
    listAvailableSkills: (input) =>
      read("listAvailableSkills", input, (queries, request) =>
        queries.listAvailableSkills(request),
      ),
    listAvailableSubagents: (input) =>
      read("listAvailableSubagents", input, (queries, request) =>
        queries.listAvailableSubagents(request),
      ),
    searchFiles: (input) =>
      read("searchFiles", input, (queries, request) => queries.searchFiles(request)),
    loadSessionHistory: (input) =>
      read("loadSessionHistory", input, (queries, request) => queries.loadSessionHistory(request)),
    loadSessionTodos: (input) =>
      read("loadSessionTodos", input, (queries, request) => queries.loadSessionTodos(request)),
    loadSessionDiff: (input) =>
      read("loadSessionDiff", input, (queries, request) => queries.loadSessionDiff(request)),
    loadFileStatus: (input) =>
      read("loadFileStatus", input, (queries, request) => queries.loadFileStatus(request)),
  };

  function resolveAdapter(
    input: RepoRuntimeRef,
    operation: string,
  ): Effect.Effect<
    {
      runtime: RuntimeInstanceSummary;
      adapter: AgentSessionLiveAdapterPort;
    },
    RuntimeQueryError
  > {
    return Effect.gen(function* () {
      const runtime = yield* dependencies.runtimeRegistry
        .findWorkspaceRuntime(input)
        .pipe(
          Effect.mapError((cause) =>
            runtimeQueryError(
              operation,
              input,
              "runtime_unavailable",
              "Cannot resolve the selected runtime. Start it from the runtime controls.",
              cause,
            ),
          ),
        );
      const adapter = yield* dependencies.adapterRegistry
        .resolveForScope(input)
        .pipe(
          Effect.mapError((cause) =>
            runtimeQueryError(
              operation,
              input,
              "runtime_unavailable",
              "The selected runtime has no active query adapter. Start it from the runtime controls.",
              cause,
            ),
          ),
        );
      if (
        !runtime ||
        runtime.runtimeId !== adapter.binding.runtimeId ||
        runtime.kind !== input.runtimeKind ||
        runtime.repoPath !== input.repoPath
      ) {
        return yield* runtimeQueryError(
          operation,
          input,
          "runtime_unavailable",
          "The selected runtime changed or stopped. Reload the runtime data.",
        );
      }
      return { runtime, adapter };
    });
  }
};

const supportsQuery = (runtime: RuntimeDescriptor, method: QueryMethod): boolean => {
  const { promptInput, optionalSurfaces, history } = runtime.capabilities;
  switch (method) {
    case "listAvailableModels":
      return true;
    case "listAvailableSlashCommands":
      return promptInput.supportsSlashCommands;
    case "listAvailableSkills":
      return promptInput.supportsSkillReferences;
    case "listAvailableSubagents":
      return promptInput.supportsSubagentReferences;
    case "searchFiles":
      return promptInput.supportsFileSearch;
    case "loadSessionHistory":
      return history.loadable;
    case "loadSessionTodos":
      return optionalSurfaces.supportsTodos;
    case "loadSessionDiff":
      return optionalSurfaces.supportsDiff;
    case "loadFileStatus":
      return optionalSurfaces.supportsFileStatus;
  }
};
